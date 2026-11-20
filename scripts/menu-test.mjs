// Browser test of the pause menu, scores and saving, in headless Chromium.
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
      import { createScore } from './src/systems/score.js';
      import { createMenu } from './src/ui/menu.js';
      import { getHandlingMode } from './src/entities/vehicle.js';
      const root = document.createElement('div');
      root.style.cssText = 'position:fixed;inset:0;background:linear-gradient(#9fc8e8,#6d8f5a)';
      document.body.appendChild(root);
      const log = { hudModes: [], resizes: 0, volume: null, toasts: [], touchVisible: true, steer: [], lefty: null, noTilt: false };
      const game = {
        events: createEvents(), progress: defaultProgress(), paused: false, quality: 1,
        player: { x: 0, z: 0 }, input: {},
        hud: { toast: (t) => log.toasts.push(t) },
        touch: {
          setVisible: (v) => { log.touchVisible = v; },
          setLeftHanded: (v) => { log.lefty = v; },
          setHudMode: (m) => { log.hudModes.push(m); },
          // Like the real controls: tilt without a sensor falls back to the wheel.
          setSteering: (st, sens, onFallback) => {
            log.steer.push([st, sens]);
            if (st === 'tilt' && log.noTilt) { if (onFallback) onFallback('wheel', 'unsupported'); return 'wheel'; }
            return st;
          },
        },
        audio: { setVolume: (v) => { log.volume = v.master; } },
        resize: () => { log.resizes++; },
        activities: { courses: [{ id: 'race_harbour', name: 'Harbour Dash', type: 'race' }] },
      };
      const economy = createEconomy(game, window.localStorage);
      game.score = createScore(game);
      const menu = createMenu(root, game, economy);
      window.rw = { game, economy, menu, log, getHandlingMode, score: game.score };
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
    if (window.name === 'v1') {
      window.name = '';
      localStorage.setItem('rustwater.save.v1', JSON.stringify({
        money: 4321, owned: ['jet'], medals: { race_harbour: 'gold', seen_docks: 'bronze', hint_car: 'bronze' },
        bestTimes: { race_harbour: 70.5 }, stats: { distance: 9000, flights: 3, races: 4 }, settings: { quality: 0.75, handling: 'sim', steering: 'slider' },
      }));
    }
    if (window.name === 'tamper') {
      window.name = '';
      localStorage.setItem('rustwater.save.v1', '{"money":"1e999","owned":["jet","<img src=x onerror=alert(1)>"],"__proto__":{"polluted":1},"score":{"total":99999},"medals":{"<img src=x onerror=alert(2)>":"gold","bad_x":"<b>x</b>"}}');
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
  const lastSteer = () => ev(() => window.rw.log.steer[window.rw.log.steer.length - 1]);
  check('handling arcade at load', (await ev(() => window.rw.getHandlingMode())) === 'arcade');
  check('steering applied at load', JSON.stringify(await lastSteer()) === '["wheel",1]', JSON.stringify(await lastSteer()));

  // First run: ask how to steer, paused, once.
  check('first run asks how to steer', (await ev(() => window.rw.menu.maybeAskSteering())) === true);
  check('ask pauses the game', (await ev(() => window.rw.game.paused)) === true && (await ev(() => window.rw.log.touchVisible)) === false);
  check('ask shows four choices', (await page.locator('.rw-menu-ask [data-steering]').count()) === 4);
  check('ask not stacked', (await ev(() => window.rw.menu.maybeAskSteering())) === false);
  await page.screenshot({ path: path.join(out, 'ask-steer-915x412.png') });
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(100);
  const askFit = await ev(() => {
    const b = document.querySelector('.rw-menu-askbox').getBoundingClientRect();
    const bad = [...document.querySelectorAll('.rw-menu-ask button')].filter((e) => {
      const q = e.getBoundingClientRect();
      return q.height < 55.5 || q.bottom > innerHeight || q.right > innerWidth || q.left < 0;
    }).length;
    return { bad, fits: b.bottom <= innerHeight && b.top >= 0 && document.documentElement.scrollWidth <= innerWidth };
  });
  check('ask fits 780x360', askFit.bad === 0 && askFit.fits, JSON.stringify(askFit));
  await page.screenshot({ path: path.join(out, 'ask-steer-780x360.png') });
  await page.setViewportSize({ width: 915, height: 412 });
  await page.locator('.rw-menu-ask [data-steering="buttons"]').tap();
  check('ask: pick applies at once', JSON.stringify(await lastSteer()) === '["buttons",1]', JSON.stringify(await lastSteer()));
  check('ask: closes and unpauses', !(await ev(() => window.rw.menu.isAsking())) && (await ev(() => window.rw.game.paused)) === false
    && (await ev(() => window.rw.log.touchVisible)) === true);
  check('ask: saved choice + seen flag', (await stored()).settings.steering === 'buttons' && (await stored()).medals.hint_steer === 'bronze');
  await load();
  check('ask: only once', (await ev(() => window.rw.menu.maybeAskSteering())) === false);
  check('ask: choice restored', JSON.stringify(await lastSteer()) === '["buttons",1]');
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  check('pause opens menu', await isOpen());
  check('touch hidden while open', (await ev(() => window.rw.log.touchVisible)) === false);

  // Every tab renders.
  const shots = async (size) => {
    for (const [name, file] of [['Resume', 'resume'], ['Scores', 'scores'], ['Records', 'records'], ['Settings', 'settings'], ['How to play', 'howto']]) {
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
  await ev(() => {
    const sc = window.rw.game.progress.score;
    sc.sessionBest = 4200;
    sc.best.combo = 3.5;
    sc.best.jump = 41.2;
    sc.best.airtime = 2.4;
    sc.best.drift = 800;
    sc.best.nearMiss = 4;
    sc.courses.race_harbour = 3500;
    sc.missions.m1 = { best: 5200, time: 181.5, done: true };
    window.rw.score.add(2000, 'test award', 0, 0, true);
  });
  await shots('915x412');
  check('no Showroom tab', (await page.getByRole('tab', { name: 'Showroom' }).count()) === 0);
  check('five tabs', (await page.getByRole('tab').count()) === 5);
  await tab('Scores');
  const sco = await page.locator('.rw-menu-body').innerText();
  check('scores show nice name', sco.includes('Harbour Dash'), sco);
  check('scores prettify ids', sco.includes('Air Loop'), sco);
  check('scores total', sco.includes('2,000'), sco);
  check('scores best session and combo', sco.includes('4,200') && sco.includes('x3.5'), sco);
  check('scores best time', sco.includes('1:23.4'), sco);
  check('scores course high score', sco.includes('3,500 pts'), sco);
  check('scores mission', sco.includes('5,200'), sco);
  check('medals as achievements', /achievements/i.test(sco) && sco.includes('1 gold, 1 silver'), sco);
  check('scores hide flags', !/hint|seen/i.test(sco), sco);
  check('header shows points', (await page.locator('.rw-menu-points').innerText()) === '2,000 pts');
  check('no money or buy anywhere', (await page.locator('.rw-menu button', { hasText: /buy|\$/i }).count()) === 0);
  await tab('Records');
  const rec = await page.locator('.rw-menu-body').innerText();
  check('records distance km', rec.includes('12.3 km'), rec);
  check('economy has no buy', await ev(() => window.rw.economy.buy === undefined));

  // Resume button unpauses.
  await tab('Resume');
  await page.locator('[data-role="resume"]').tap();
  check('resume closes', !(await isOpen()));
  check('resume unpauses', (await ev(() => window.rw.game.paused)) === false);
  check('touch back', (await ev(() => window.rw.log.touchVisible)) === true);

  // Scores persist across reload.
  await ev(() => { window.rw.economy.save(); });
  await load();
  let pr = await progress();
  check('score persists', pr.score.total === 2000 && pr.score.sessionBest === 4200 && pr.score.courses.race_harbour === 3500, JSON.stringify(pr.score));
  check('live score restored', (await ev(() => window.rw.score.total)) === 2000);
  check('save is version 3 without money', (await stored()).version === 3 && (await stored()).money === undefined && (await stored()).owned === undefined);

  // Settings persist.
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  await tab('Settings');
  check('settings: four steering choices', (await page.locator('.rw-menu-body [data-steering]').count()) === 4);
  check('settings: current style marked', (await page.locator('.rw-menu-body [data-steering="buttons"]').getAttribute('aria-checked')) === 'true');
  await page.locator('.rw-menu-body [data-steering="slider"]').tap();
  check('settings: steering applied at once', JSON.stringify(await lastSteer()) === '["slider",1]', JSON.stringify(await lastSteer()));
  check('settings: choice marked', (await page.locator('.rw-menu-body [data-steering="slider"]').getAttribute('aria-checked')) === 'true');
  await ev(() => {
    const s = document.querySelector('[data-setting="steerSensitivity"]');
    s.value = '130';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  check('settings: sensitivity applied', JSON.stringify(await lastSteer()) === '["slider",1.3]', JSON.stringify(await lastSteer()));
  check('settings: sensitivity shown', (await page.locator('.rw-menu-sens').innerText()) === '130%');
  // Tilt where the phone cannot: back to the wheel with a message.
  await ev(() => { window.rw.log.noTilt = true; });
  await page.locator('.rw-menu-body [data-steering="tilt"]').tap();
  let fb = (await progress()).settings.steering;
  check('settings: tilt unavailable falls back to wheel', fb === 'wheel' && (await ev(() => window.rw.log.toasts.join())).includes('Tilt'), fb);
  check('settings: fallback shown in menu', (await page.locator('.rw-menu-body [data-steering="wheel"]').getAttribute('aria-checked')) === 'true');
  await ev(() => { window.rw.log.noTilt = false; });
  await page.locator('.rw-menu-body [data-steering="tilt"]').tap();
  check('settings: tilt kept where it works', (await progress()).settings.steering === 'tilt');
  await page.screenshot({ path: path.join(out, 'settings-steering-915x412.png') });
  // Handling: two choices, arcade by default, realistic applies at once.
  check('settings: two handling choices', (await page.locator('.rw-menu-body [data-handling]').count()) === 2);
  check('settings: arcade marked', (await page.locator('.rw-menu-body [data-handling="arcade"]').getAttribute('aria-checked')) === 'true');
  const hText = await page.locator('.rw-menu-body [data-handling="sim"]').innerText();
  check('settings: realistic labelled', hText.includes('Realistic') && hText.includes('grip'), hText);
  await page.locator('.rw-menu-body [data-handling="sim"]').scrollIntoViewIfNeeded();
  await page.locator('.rw-menu-body [data-handling="sim"]').tap();
  check('settings: handling applied at once', (await ev(() => window.rw.getHandlingMode())) === 'sim' && (await progress()).settings.handling === 'sim');
  check('settings: realistic marked', (await page.locator('.rw-menu-body [data-handling="sim"]').getAttribute('aria-checked')) === 'true'
    && (await page.locator('.rw-menu-body [data-handling="arcade"]').getAttribute('aria-checked')) === 'false');
  check('settings: handling saved', (await stored()).settings.handling === 'sim');
  await page.screenshot({ path: path.join(out, 'settings-handling-915x412.png') });
  // HUD: Minimal by default, Full applies at once and is saved.
  check('settings: two HUD choices, minimal marked', (await page.locator('.rw-menu-body [data-hud]').count()) === 2
    && (await page.locator('.rw-menu-body [data-hud="minimal"]').getAttribute('aria-checked')) === 'true');
  await page.locator('.rw-menu-body [data-hud="full"]').scrollIntoViewIfNeeded();
  await page.locator('.rw-menu-body [data-hud="full"]').tap();
  check('settings: HUD full applied at once and saved', (await ev(() => window.rw.log.hudModes.at(-1))) === 'full'
    && (await stored()).settings.hud === 'full' && (await page.locator('.rw-menu-body [data-hud="full"]').getAttribute('aria-checked')) === 'true');
  await page.locator('.rw-menu-body [data-hud="minimal"]').tap();
  check('settings: HUD back to minimal', (await ev(() => window.rw.log.hudModes.at(-1))) === 'minimal' && (await stored()).settings.hud === 'minimal');
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
  check('left-handed applied to controls', (await ev(() => window.rw.log.lefty)) === true);
  check('quality applied to game', (await ev(() => window.rw.game.quality)) === 1.25 && (await ev(() => window.rw.log.resizes)) > 0);
  check('volume applied', Math.abs((await ev(() => window.rw.log.volume)) - 0.35) < 1e-9);
  check('invert applied', (await ev(() => window.rw.game.input.invertPitch)) === true);
  await tab('How to play');
  check('howto matches invert', (await page.locator('.rw-menu-body').innerText()).includes('Pull the stick down to climb'));
  await load();
  st = (await progress()).settings;
  check('settings persist', st.invertPitch && st.leftHanded && !st.police && st.quality === 1.25 && Math.abs(st.master - 0.35) < 1e-9, JSON.stringify(st));
  check('steering settings persist', st.steering === 'tilt' && st.steerSensitivity === 1.3, JSON.stringify(st));
  check('handling persists and is applied', st.handling === 'sim' && (await ev(() => window.rw.getHandlingMode())) === 'sim', JSON.stringify(st));
  check('steering restored to controls', JSON.stringify(await lastSteer()) === '["tilt",1.3]' && (await ev(() => window.rw.log.lefty)) === true);
  check('quality restored to game', (await ev(() => window.rw.game.quality)) === 1.25);

  // Reset needs two steps.
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  await tab('Settings');
  await ev(() => { window.refP = window.rw.game.progress; window.refO = window.rw.game.progress.score; });
  await page.locator('[data-role="reset"]').tap();
  check('reset first step keeps data', (await progress()).score.total === 2000);
  await page.screenshot({ path: path.join(out, 'settings-confirm-915x412.png') });
  await page.locator('[data-role="reset-confirm"]').tap();
  pr = await progress();
  check('reset clears', pr.score.total === 0 && pr.score.sessionBest === 0 && Object.keys(pr.score.courses).length === 0 && pr.settings.quality === 1 && pr.settings.police === true
    && pr.settings.steering === 'wheel' && pr.settings.steerSensitivity === 1 && pr.settings.handling === 'arcade', JSON.stringify(pr));
  check('reset re-applies arcade handling', (await ev(() => window.rw.getHandlingMode())) === 'arcade');
  check('reset re-applies steering', JSON.stringify(await lastSteer()) === '["wheel",1]');
  const sv = await stored();
  check('reset saved', sv && sv.version === 3 && sv.score.total === 0);
  check('progress object kept in place', await ev(() => window.rw.game.progress === window.refP && window.rw.game.progress.score === window.refO));

  // An old version 1 save migrates in the browser: nothing lost.
  await page.evaluate(() => { window.name = 'v1'; });
  await load();
  pr = await progress();
  check('v1 migrates: total money x 10', pr.score.total === 43210 && pr.version === 3, JSON.stringify(pr.score));
  check('v1 migrates: nothing lost', pr.medals.race_harbour === 'gold' && pr.medals.seen_docks === 'bronze' && pr.medals.hint_car === 'bronze'
    && pr.bestTimes.race_harbour === 70.5 && pr.stats.races === 4 && pr.settings.quality === 0.75 && pr.settings.handling === 'sim' && pr.settings.steering === 'slider', JSON.stringify(pr));

  // Tampered storage.
  await page.evaluate(() => { window.name = 'tamper'; });
  await load();
  pr = await progress();
  check('tamper: score safe', pr.score.total === 0 && pr.money === undefined, JSON.stringify(pr.score));
  check('tamper: owned gone', pr.owned === undefined);
  check('tamper: medals clean', Object.keys(pr.medals).length === 0);
  check('tamper: no pollution', await ev(() => ({}).polluted === undefined));
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  for (const n of ['Scores', 'Records', 'Settings']) await tab(n);
  check('tamper: nothing executed', await ev(() => !document.querySelector('.rw-menu img')));
  await page.waitForTimeout(200);

  // Smaller phone.
  await page.setViewportSize({ width: 780, height: 360 });
  await shots('780x360');
  // Layout: nothing wider than the screen, content scrolls instead of being cut.
  for (const size of [{ width: 915, height: 412 }, { width: 780, height: 360 }]) {
    await page.setViewportSize(size);
    for (const n of ['Resume', 'Scores', 'Records', 'Settings', 'How to play']) {
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
