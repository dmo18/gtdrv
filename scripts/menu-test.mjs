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
        audio: { setVolume: (v) => { log.volume = v.master; log.vol = v; } },
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

  // Every section renders (docs/REVAMP.md 6.4: Resume, Stats, Settings, Help).
  const shots = async (size) => {
    for (const [name, file] of [['Resume', 'resume'], ['Stats', 'stats'], ['Settings', 'settings'], ['Help', 'help']]) {
      await tab(name);
      const text = await page.locator('.rw-menu-body').innerText();
      check(`tab ${name} has content`, text.length > 20 || name === 'Settings');
      await page.screenshot({ path: path.join(out, `${file}-${size}.png`) });
    }
  };
  const grp = (g) => page.locator(`.rw-menu-groups [data-group="${g}"]`).tap();
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
    window.rw.score.add(2000, 'test award', 0, 0, true);
  });
  await shots('915x412');
  check('four sections, no Scores or Records or Showroom tab', (await page.locator('.rw-menu-rail .rw-menu-tab').count()) === 4
    && (await page.getByRole('tab', { name: 'Scores' }).count()) === 0 && (await page.getByRole('tab', { name: 'Records' }).count()) === 0);
  await tab('Stats');
  const sco = await page.locator('.rw-menu-body').innerText();
  check('stats total', sco.includes('2,000'), sco);
  check('stats best session and combo', sco.includes('4,200') && sco.includes('x3.5'), sco);
  check('stats distance in miles', sco.includes('7.7 mi'), sco);
  check('stats medals count and secrets line', /Medals/.test(sco) && /Secrets 0 \/ 6/.test(sco), sco);
  check('stats hide flags', !/hint|seen_/i.test(sco), sco);
  check('header shows points', (await page.locator('.rw-menu-points').innerText()) === '2,000 pts');
  check('no money or buy anywhere', (await page.locator('.rw-menu button', { hasText: /buy|\$/i }).count()) === 0);
  check('economy has no buy', await ev(() => window.rw.economy.buy === undefined));
  await tab('Help');
  const help = await page.locator('.rw-menu-body').innerText();
  check('help has the credit line and the version', help.includes('Map data (c) OpenStreetMap contributors, ODbL') && /Rustwater/.test(help), help.slice(-120));

  // The back button is the same place on every screen; on a top screen it resumes.
  await tab('Resume');
  const bk1 = await page.locator('.rw-menu-back').boundingBox();
  await tab('Stats');
  const bk2 = await page.locator('.rw-menu-back').boundingBox();
  check('back button 48 by 48, top left, same place', Math.abs(bk1.width - 48) < 1 && Math.abs(bk1.height - 48) < 1 && bk1.x === bk2.x && bk1.y === bk2.y && bk1.x < 20 && bk1.y < 20, JSON.stringify([bk1, bk2]));
  await tab('Resume');
  await page.locator('[data-role="resume"]').tap();
  check('resume closes', !(await isOpen()));
  check('resume unpauses', (await ev(() => window.rw.game.paused)) === false);
  check('touch back', (await ev(() => window.rw.log.touchVisible)) === true);
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  await page.locator('.rw-menu-back').tap();
  check('the top-left button on a top screen resumes', !(await isOpen()) && (await ev(() => window.rw.game.paused)) === false);

  // Scores persist across reload.
  await ev(() => { window.rw.economy.save(); });
  await load();
  let pr = await progress();
  check('score persists', pr.score.total === 2000 && pr.score.sessionBest === 4200, JSON.stringify(pr.score));
  check('live score restored', (await ev(() => window.rw.score.total)) === 2000);
  check('save is version 3 without money', (await stored()).version === 3 && (await stored()).money === undefined && (await stored()).owned === undefined);

  // Settings: four groups, rows as in the table, applied and saved.
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  await tab('Settings');
  check('settings: four groups', (await page.locator('.rw-menu-groups button').count()) === 4);
  const rowCount = () => page.locator('.rw-menu-body .rw-menu-setting').count();
  await grp('controls');
  check('controls: 5 rows', (await rowCount()) === 5);
  await grp('sound');
  check('sound: 6 rows, no music on/off switch', (await rowCount()) === 6 && (await page.locator('[data-setting="music"]').count()) === 0);
  await grp('game');
  check('game: 4 rows (police, hard, map, new game)', (await rowCount()) === 4);
  await grp('display');
  // 5 rows from 0.5.0: the Phone check (docs/PLAN_V1.md 4.2) joins HUD, graphics quality, live day and night and time of day (at most 6)
  check('display: 5 rows (HUD, quality, live time, time of day, Phone check)', (await rowCount()) === 5 && (await page.locator('[data-role="phonecheck"]').count()) === 1);
  check('time of day greyed while live is on', await ev(() => document.querySelector('[data-setting="timeOfDay"]').disabled === true));
  await grp('controls');
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
  check('settings: sensitivity shown', (await page.locator('[data-setting="steerSensitivity"] + .rw-menu-value').innerText()) === '130%');
  // Tilt where the phone cannot: back to the wheel with a message.
  await ev(() => { window.rw.log.noTilt = true; });
  await page.locator('.rw-menu-body [data-steering="tilt"]').tap();
  const fb = (await progress()).settings.steering;
  check('settings: tilt unavailable falls back to wheel', fb === 'wheel' && (await ev(() => window.rw.log.toasts.join())).includes('Tilt'), fb);
  check('settings: fallback shown in menu', (await page.locator('.rw-menu-body [data-steering="wheel"]').getAttribute('aria-checked')) === 'true');
  await ev(() => { window.rw.log.noTilt = false; });
  await page.locator('.rw-menu-body [data-steering="tilt"]').tap();
  check('settings: tilt kept where it works', (await progress()).settings.steering === 'tilt');
  await page.screenshot({ path: path.join(out, 'settings-controls-915x412.png') });
  check('settings: two handling choices, arcade marked', (await page.locator('.rw-menu-body [data-handling]').count()) === 2
    && (await page.locator('.rw-menu-body [data-handling="arcade"]').getAttribute('aria-checked')) === 'true');
  await page.locator('.rw-menu-body [data-handling="sim"]').tap();
  check('settings: handling applied at once and saved', (await ev(() => window.rw.getHandlingMode())) === 'sim' && (await progress()).settings.handling === 'sim' && (await stored()).settings.handling === 'sim');
  check('settings: sim marked', (await page.locator('.rw-menu-body [data-handling="sim"]').getAttribute('aria-checked')) === 'true'
    && (await page.locator('.rw-menu-body [data-handling="arcade"]').getAttribute('aria-checked')) === 'false');
  await page.locator('[data-setting="invertPitch"]').tap();
  await page.locator('[data-setting="leftHanded"]').tap();
  await grp('game');
  await page.locator('[data-setting="police"]').tap();
  await grp('display');
  check('settings: two HUD choices, minimal marked', (await page.locator('.rw-menu-body [data-hud]').count()) === 2
    && (await page.locator('.rw-menu-body [data-hud="minimal"]').getAttribute('aria-checked')) === 'true');
  await page.locator('.rw-menu-body [data-hud="full"]').tap();
  check('settings: HUD full applied at once and saved', (await ev(() => window.rw.log.hudModes.at(-1))) === 'full'
    && (await stored()).settings.hud === 'full' && (await page.locator('.rw-menu-body [data-hud="full"]').getAttribute('aria-checked')) === 'true');
  await page.locator('.rw-menu-body [data-hud="minimal"]').tap();
  check('settings: HUD back to minimal', (await ev(() => window.rw.log.hudModes.at(-1))) === 'minimal' && (await stored()).settings.hud === 'minimal');
  await page.locator('[data-quality="1.25"]').tap();
  await grp('sound');
  await ev(() => {
    const s = document.querySelector('[data-setting="master"]');
    s.value = '35';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const st0 = (await progress()).settings;
  check('settings applied', st0.invertPitch && st0.leftHanded && !st0.police && st0.quality === 1.25 && Math.abs(st0.master - 0.35) < 1e-9, JSON.stringify(st0));
  check('left-handed applied to controls', (await ev(() => window.rw.log.lefty)) === true);
  check('quality applied to game', (await ev(() => window.rw.game.quality)) === 1.25 && (await ev(() => window.rw.log.resizes)) > 0);
  check('volume applied', Math.abs((await ev(() => window.rw.log.volume)) - 0.35) < 1e-9);
  for (const key of ['master', 'musicVol', 'sfxVol', 'ambVol']) {
    check('settings: ' + key + ' slider', (await page.locator(`.rw-menu-body input[data-setting="${key}"]`).count()) === 1);
  }
  check('settings: master percent shown', (await page.locator('[data-setting="master"] + .rw-menu-value').innerText()) === '35%');
  await ev(() => {
    const s = document.querySelector('[data-setting="sfxVol"]');
    s.value = '40';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  check('settings: effects volume applied and saved', Math.abs((await ev(() => window.rw.log.vol.sfx)) - 0.4) < 1e-9 && Math.abs((await progress()).settings.sfxVol - 0.4) < 1e-9);
  await page.locator('[data-setting="muteAll"]').tap();
  check('settings: mute all applied, master kept', (await ev(() => window.rw.log.vol.muteAll)) === true && Math.abs((await ev(() => window.rw.log.vol.master)) - 0.35) < 1e-9);
  await page.locator('[data-setting="muteAll"]').tap();
  check('settings: unmute', (await ev(() => window.rw.log.vol.muteAll)) === false);
  check('invert applied', (await ev(() => window.rw.game.input.invertPitch)) === true);
  await page.screenshot({ path: path.join(out, 'settings-sound-915x412.png') });
  await tab('Help');
  check('help matches invert', (await page.locator('.rw-menu-body').innerText()).includes('Pull the stick down to climb'));
  await load();
  const st = (await progress()).settings;
  check('settings persist', st.invertPitch && st.leftHanded && !st.police && st.quality === 1.25 && Math.abs(st.master - 0.35) < 1e-9, JSON.stringify(st));
  check('steering settings persist', st.steering === 'tilt' && st.steerSensitivity === 1.3, JSON.stringify(st));
  check('handling persists and is applied', st.handling === 'sim' && (await ev(() => window.rw.getHandlingMode())) === 'sim', JSON.stringify(st));
  check('steering restored to controls', JSON.stringify(await lastSteer()) === '["tilt",1.3]' && (await ev(() => window.rw.log.lefty)) === true);
  check('quality restored to game', (await ev(() => window.rw.game.quality)) === 1.25);

  // New game and Map choice are their own screens, reached from Settings, Game; every confirm needs two taps.
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  await tab('Settings');
  await grp('game');
  check('game group: the Map row names the current map', (await page.locator('[data-role="map"]').innerText()).includes('Miami'));
  await page.locator('[data-role="newgame"]').tap();
  check('New game screen opens', (await page.locator('.rw-menu-title').innerText()) === 'New game' && (await page.locator('.rw-menu-confirmrow').count()) === 2);
  await page.screenshot({ path: path.join(out, 'newgame-915x412.png') });
  await page.locator('.rw-menu-back').tap();
  check('Back returns to Settings, Game', (await page.locator('.rw-menu-groups [data-group="game"]').getAttribute('aria-selected')) === 'true' && (await page.locator('[data-role="newgame"]').count()) === 1);
  await ev(() => { window.refP = window.rw.game.progress; window.refO = window.rw.game.progress.score; window.rw.newGames = 0; window.rw.game.newSession = () => { window.rw.newGames++; }; });
  await page.locator('[data-role="newgame"]').tap();
  const nb = await page.locator('.rw-menu-confirmrow [data-role="reset"]').boundingBox();
  await page.locator('[data-role="reset"]').tap();
  check('erase first tap keeps data and arms', (await progress()).score.total === 2000 && (await page.locator('[data-role="reset-confirm"]').count()) === 1);
  const cb = await page.locator('[data-role="reset-cancel"]').boundingBox();
  check('Cancel sits where the first button was, the red Yes beside it', Math.abs(cb.x + cb.width / 2 - (nb.x + nb.width / 2)) < nb.width / 2 + 1
    && (await page.locator('[data-role="reset-confirm"]').boundingBox()).x < cb.x && (await page.locator('[data-role="reset-confirm"]').innerText()) === 'Yes, erase everything');
  await page.screenshot({ path: path.join(out, 'confirm-armed-915x412.png') });
  await page.touchscreen.tap(nb.x + nb.width / 2, nb.y + nb.height / 2);
  check('a double tap on the first button cancels', (await page.locator('[data-role="reset-confirm"]').count()) === 0 && (await progress()).score.total === 2000);
  await page.locator('[data-role="reset"]').tap();
  await page.locator('.rw-menu-back').tap();
  await page.locator('[data-role="newgame"]').tap();
  check('the armed state ends on leaving the screen', (await page.locator('[data-role="reset-confirm"]').count()) === 0);
  await page.locator('[data-role="newgame"]').tap();
  check('new game arms first', (await page.locator('[data-role="newgame-confirm"]').count()) === 1 && (await ev(() => window.rw.newGames)) === 0);
  await page.locator('[data-role="newgame-confirm"]').tap();
  check('new game after the second tap: the session restarts, the menu closes, the score stays', (await ev(() => window.rw.newGames)) === 1 && !(await isOpen()) && (await progress()).score.total === 2000);
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  await tab('Settings');
  await grp('game');
  await page.locator('[data-role="newgame"]').tap();
  await page.locator('[data-role="reset"]').tap();
  await page.locator('[data-role="reset-confirm"]').tap();
  const pr0 = await progress();
  check('reset clears', pr0.score.total === 0 && pr0.score.sessionBest === 0 && Object.keys(pr0.score.courses).length === 0 && pr0.settings.quality === 1 && pr0.settings.police === true
    && pr0.settings.steering === 'wheel' && pr0.settings.steerSensitivity === 1 && pr0.settings.handling === 'arcade', JSON.stringify(pr0));
  check('reset re-applies arcade handling and steering', (await ev(() => window.rw.getHandlingMode())) === 'arcade' && JSON.stringify(await lastSteer()) === '["wheel",1]');
  const sv = await stored();
  check('reset saved', sv && sv.version === 3 && sv.score.total === 0);
  check('progress object kept in place', await ev(() => window.rw.game.progress === window.refP && window.rw.game.progress.score === window.refO));
  // Map choice: two cards, the other one arms a confirm, Yes switches.
  await page.locator('.rw-menu-back').tap();
  await page.locator('[data-role="map"]').tap();
  check('Map choice: two cards, Miami marked', (await page.locator('.rw-menu-card').count()) === 2 && (await page.locator('.rw-menu-card[data-map="miami"]').getAttribute('data-current')) === 'true');
  await page.locator('[data-role="map-island"]').tap();
  check('Map choice: the other map arms, with the warning and the named Yes', (await page.locator('[data-role="map-island-confirm"]').innerText()) === 'Yes, switch to the classic island'
    && (await page.locator('.rw-menu-card[data-map="island"]').innerText()).includes('Switching restarts the game'));
  await page.screenshot({ path: path.join(out, 'mapchoice-armed-915x412.png') });
  await page.locator('[data-role="map-island-cancel"]').tap();
  check('Map choice: Cancel disarms and nothing changed', (await page.locator('[data-role="map-island-confirm"]').count()) === 0 && (await ev(() => localStorage.getItem('rustwater.map'))) === null);
  await page.locator('[data-role="map-island"]').tap();
  await Promise.all([page.waitForNavigation().catch(() => {}), page.locator('[data-role="map-island-confirm"]').tap()]);
  await page.waitForFunction(() => window.rw);
  check('Map choice: Yes saves the map and restarts', (await ev(() => localStorage.getItem('rustwater.map'))) === 'island');
  await ev(() => localStorage.removeItem('rustwater.map'));

  // Registered screens (W11 adds Garage, Garages, Adventures this way).
  await load();
  await ev(() => {
    window.rw.regYes = 0;
    window.rw.menu.registerScreen({ id: 'demo', title: 'Demo screen', render(body, api) {
      body.appendChild(api.confirmRow('Release car', 'Yes, release the Selwick', () => { window.rw.regYes++; api.back(); }, { id: 'rel' }));
    } });
    window.rw.menu.open('demo');
  });
  check('a registered screen opens by id with its title', (await isOpen()) && (await page.locator('.rw-menu-title').innerText()) === 'Demo screen');
  await page.locator('[data-role="rel"]').tap();
  check('the registered confirm row asks twice', (await ev(() => window.rw.regYes)) === 0 && (await page.locator('[data-role="rel-confirm"]').count()) === 1);
  await page.locator('[data-role="rel-confirm"]').tap();
  check('Yes runs it and api.back() leaves the menu (opened from outside)', (await ev(() => window.rw.regYes)) === 1 && !(await isOpen()));

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
  for (const n of ['Stats', 'Settings']) await tab(n);
  check('tamper: nothing executed', await ev(() => !document.querySelector('.rw-menu img')));
  await page.waitForTimeout(200);

  // Smaller phone: every screen at both sizes, every group; rows 48 px or more; nothing scrolls except Help.
  for (const size of [{ width: 915, height: 412 }, { width: 780, height: 360 }]) {
    await page.setViewportSize(size);
    await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
    const probe = () => ev(() => {
      const b = document.querySelector('.rw-menu-body');
      const bad = [];
      const r = b.getBoundingClientRect();
      for (const e of document.querySelectorAll('.rw-menu button')) {
        const q = e.getBoundingClientRect();
        if (!q.width) continue;
        if (q.right > innerWidth + 1 || q.left < -1 || q.bottom > innerHeight + 1) bad.push('off:' + e.textContent);
        if (q.height < 47.5 || q.width < 47.5) bad.push('small:' + e.textContent + ':' + Math.round(q.width) + 'x' + Math.round(q.height));
      }
      for (const e of document.querySelectorAll('.rw-menu-body input[type=range]')) if (e.getBoundingClientRect().height < 47.5) bad.push('slider');
      return { bad, over: document.documentElement.scrollWidth > innerWidth, sx: b.scrollWidth > b.clientWidth + 1, sy: b.scrollHeight - b.clientHeight, bot: r.bottom <= innerHeight + 0.5 };
    });
    for (const [n, scrolls] of [['Resume', false], ['Stats', false], ['Help', true]]) {
      await tab(n);
      const m = await probe();
      check(`layout ${n} ${size.width}: targets 48+, in view, ${scrolls ? 'may scroll' : 'no scroll'}`, !m.bad.length && !m.over && !m.sx && (scrolls || m.sy <= 1), JSON.stringify(m));
    }
    await tab('Settings');
    for (const g of ['controls', 'sound', 'game', 'display']) {
      await grp(g);
      const m = await probe();
      check(`layout Settings ${g} ${size.width}: targets 48+, in view, no scroll`, !m.bad.length && !m.over && !m.sx && m.sy <= 1 && m.bot, JSON.stringify(m));
      await page.screenshot({ path: path.join(out, `settings-${g}-${size.width}x${size.height}.png`) });
    }
    await grp('game');
    for (const role of ['newgame', 'map']) {
      await page.locator(`[data-role="${role}"]`).tap();
      const m = await probe();
      check(`layout ${role} screen ${size.width}: targets 48+, no scroll`, !m.bad.length && !m.over && m.sy <= 1, JSON.stringify(m));
      await page.screenshot({ path: path.join(out, `${role}-${size.width}x${size.height}.png`) });
      await page.locator('.rw-menu-back').tap();
    }
    await page.locator('[data-role="newgame"]').tap();
    await page.locator('[data-role="reset"]').tap();
    const ma = await probe();
    check(`layout armed confirm ${size.width}: nothing cut off`, !ma.bad.length && ma.sy <= 1, JSON.stringify(ma));
    await ev(() => { window.rw.menu.close(); });
  }
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  await shots('780x360');

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
