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
      import { getHandlingMode, VEHICLE_SPECS } from './src/entities/vehicle.js';
      // The loop's screens (docs/LOOP.md): Records, Daily Three, Customize.
      import { createDaily } from './src/systems/daily.js';
      import { createCustom } from './src/systems/custom.js';
      import { trapTargets, missTargets, jumpTargets, dashTargets, heatTargets, wreckTargets } from './src/core/streetevents.js';
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
        activities: { courses: [{ id: 'race_harbor', name: 'Harbor Dash', type: 'race' }] },
      };
      const economy = createEconomy(game, window.localStorage);
      game.score = createScore(game);
      // Twelve street events (two of each template), the daily picks of a fixed date, the looks, the intro.
      const T = { trap: trapTargets(400), miss: missTargets(45, 1), jump: jumpTargets(95, 0.245, 1.5), dash: dashTargets(600), heat: heatTargets(2), wreck: wreckTargets(40, 1) };
      const list = [];
      for (const tpl of Object.keys(T)) for (let i = 1; i <= 2; i++) list.push({ id: 'ev_beach_' + tpl + '_' + i, tpl, name: (i === 1 ? 'Ocean Dr ' : 'Collins Ave ') + tpl, street: i === 1 ? 'Ocean Dr' : 'Collins Ave', targets: T[tpl], x: i * 100, z: 0 });
      log.tracked = null; log.staged = [];
      game.streetEvents = { list, slug: 'beach', track: (ev) => { log.tracked = ev ? ev.id : null; }, stage: (ev, spec) => { log.staged.push([ev.id, spec || '']); return true; } };
      game.daily = createDaily(game, { now: () => new Date(2026, 10, 23, 9, 0) });
      game.custom = createCustom(game);
      game.tutorial = { introOn: true, skip() { this.introOn = false; log.intro = 'skipped'; }, replay() { this.introOn = true; log.intro = 'replayed'; } };
      log.car = { kind: 'car', spec: VEHICLE_SPECS.muscle, color: VEHICLE_SPECS.muscle.colors[0], mesh: null };
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

async function mapScreen() {
  const { buildGame, serve } = await import('./build.mjs');
  await buildGame();
  const srv = await serve(0);
  const gbr = await (await loadChromium()).launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    for (const [W, H] of [[915, 412], [780, 360]]) {
      const pg = await (await gbr.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })).newPage();
      const errs = [];
      pg.on('pageerror', (e) => errs.push(String(e)));
      await pg.goto(`http://127.0.0.1:${srv.address().port}/?autostart`);
      await pg.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 120000 });
      await pg.waitForTimeout(1500);
      await pg.evaluate(() => { const g = window.__rw; g.paused = true; g.touch.setVisible(false); g.map.fullMap.open({ x: g.player.x, z: g.player.z, heading: g.player.heading, waypoint: null, markers: g.map.allMarkers }); });
      await pg.waitForTimeout(200);
      const btns = await pg.evaluate(() => ['map-zoom-in', 'map-zoom-out', 'map-northup'].map((r) => { const b = document.querySelector(`[data-role="${r}"]`).getBoundingClientRect(); return [r, b.width, b.height, b.left, b.top, b.right, b.bottom]; }));
      check(`map ${W}: zoom and north-up buttons 48+ and on screen`, btns.every((b) => b[1] >= 48 && b[2] >= 48 && b[3] >= 0 && b[4] >= 0 && b[5] <= W && b[6] <= H), JSON.stringify(btns));
      const z0 = await pg.evaluate(() => window.__rw.map.fullMap.getView().zoom);
      await pg.locator('[data-role="map-zoom-in"]').tap();
      const z1 = await pg.evaluate(() => window.__rw.map.fullMap.getView().zoom);
      await pg.locator('[data-role="map-zoom-out"]').tap();
      const z2 = await pg.evaluate(() => window.__rw.map.fullMap.getView().zoom);
      check(`map ${W}: + and - zoom`, z1 > z0 * 1.5 && Math.abs(z2 - z0) < 1e-6, [z0, z1, z2].join(' '));
      const labels = await pg.evaluate(() => { const f = window.__rw.map.fullMap; f.renderNow(); return f.getStats().labels; });
      // About 2.6 km by 1.2 km round the start (half of it ocean): every street with room for its name.
      check(`map ${W}: at least ${W > 900 ? 18 : 14} street names at the opening scale`, labels >= (W > 900 ? 18 : 14), String(labels));
      await pg.screenshot({ path: path.join(out, `map-streets-${W}x${H}.png`) });
      // Tap a spot 140 px up and left: a route with its summary.
      await pg.touchscreen.tap(W / 2 - 140, H / 2 - 100);
      await pg.waitForTimeout(150);
      const r = await pg.evaluate(() => { const g = window.__rw, f = g.map.fullMap; f.renderNow(); const t = g.objective.tracker; return { wp: !!g.waypoint, ok: t.route.ok, n: t.route.n, pts: f.getStats().routePts, pill: document.querySelector('[data-role="map-route"]').hidden ? '' : document.querySelector('[data-role="map-route"]').textContent }; });
      check(`map ${W}: a tap sets a destination and draws the route with its summary`, r.wp && r.ok && r.pts > 1 && / (ft|mi), \d+ min/.test(r.pill), JSON.stringify(r));
      await pg.screenshot({ path: path.join(out, `map-route-${W}x${H}.png`) });
      const nt = await pg.evaluate(() => { const f = window.__rw.map.fullMap; const b = f.getView(); return [b.width, b.height]; });
      const tgl = await pg.evaluate(() => window.__rw.progress.settings.mapNorthUp === true);
      await pg.locator('[data-role="map-northup"]').tap();
      check(`map ${W}: the north-up switch flips the setting`, (await pg.evaluate(() => window.__rw.progress.settings.mapNorthUp === true)) !== tgl);
      await pg.locator('[data-role="map-northup"]').tap();
      // Hold: cleared.
      await pg.evaluate(([w, h]) => {
        const cv = document.querySelector('.rw-map-canvas');
        const o = { pointerId: 7, pointerType: 'touch', clientX: w / 2 + 60, clientY: h / 2 + 40, bubbles: true, isPrimary: true };
        cv.dispatchEvent(new PointerEvent('pointerdown', o));
        window.__lp = o;
      }, nt);
      await pg.waitForTimeout(800);
      await pg.evaluate(() => document.querySelector('.rw-map-canvas').dispatchEvent(new PointerEvent('pointerup', window.__lp)));
      const cl = await pg.evaluate(() => ({ wp: window.__rw.waypoint, routing: window.__rw.objective.routing, pill: document.querySelector('[data-role="map-route"]').hidden }));
      check(`map ${W}: a long press clears the destination and the route`, cl.wp === null && !cl.routing && cl.pill, JSON.stringify(cl));
      // Back to the game with a route: the turn strip and the street line read.
      await pg.evaluate(() => { const g = window.__rw, c = g.city; const n = c.nodes.find((q) => q.edges.some((i) => c.edges[i].name === 'Washington Avenue') && q.edges.some((i) => c.edges[i].name === 'Lincoln Road')); g.map.fullMap.close(); g.paused = false; g.waypoint = { x: n.x, z: n.z }; g.objective.refresh(); });
      await pg.waitForTimeout(600);
      const hud = await pg.evaluate(() => { const n = document.querySelector('.rw-nav'), s = document.querySelector('.rw-street'); const r = n.getBoundingClientRect(); return { nav: getComputedStyle(n).display !== 'none' ? n.textContent : '', y: r.top, b: r.bottom, street: getComputedStyle(s).display !== 'none' ? s.textContent : '' }; });
      // 0.10.1: one compact pill in the stack's second row, "300 ft · Lincoln Rd", at most 30 px high, out of the middle half of the screen.
      check(`map ${W}: the turn pill reads "... ft/mi · street", one line at most 30 high, in the top quarter`, /^[\d.]+ (ft|mi) \u00b7 \S.+/.test(hud.nav) && hud.b - hud.y <= 30 && hud.b <= 0.25 * H, JSON.stringify(hud));
      check(`map ${W}: the street label names the street`, /\S/.test(hud.street), JSON.stringify(hud));
      await pg.screenshot({ path: path.join(out, `nav-hud-${W}x${H}.png`) });
      check(`map ${W}: no page errors`, errs.length === 0, errs.join(' | '));
      await pg.close();
    }
  } finally {
    await gbr.close();
    srv.close();
  }
}

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
        money: 4321, owned: ['jet'], medals: { race_harbor: 'gold', seen_docks: 'bronze', hint_car: 'bronze' },
        bestTimes: { race_harbor: 70.5 }, stats: { distance: 9000, flights: 3, races: 4 }, settings: { quality: 0.75, handling: 'sim', steering: 'slider' },
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
    g.progress.medals.race_harbor = 'gold';
    g.progress.medals.air_loop = 'silver';
    g.progress.bestTimes.race_harbor = 83.4;
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

  // About (Help tab, and the title): version, credits, map license, names, privacy link.
  await page.locator('[data-role="about"]').tap();
  const about = await page.locator('.rw-menu-body').innerText();
  check('about: title, version, map credit, invented names, privacy', (await page.locator('.rw-menu-title').innerText()) === 'About'
    && /Version v?\d+\.\d+\.\d+|Version dev/.test(about) && about.includes('Map data (c) OpenStreetMap contributors, ODbL') && /ODbL|Open Database License/.test(about)
    && /names .* are invented/.test(about) && /privacy/i.test(about), about);
  check('about: privacy link goes to privacy.html, no email', (await page.locator('[data-role="about-privacy-link"]').getAttribute('href')) === 'privacy.html' && !/@/.test(about));
  check('about: Help stays the selected section', (await page.locator('.rw-menu-tab[aria-selected="true"]').innerText()) === 'Help');
  await page.locator('.rw-menu-back').tap();
  check('about: Back returns to Help', (await page.locator('.rw-menu-title').innerText()) === 'Help');
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
  check('controls: 6 rows (steering, sensitivity, handling, Handling lab, left-handed, invert)', (await rowCount()) === 6 && (await page.locator('[data-role="handlinglab"]').count()) === 1);
  await grp('sound');
  check('sound: 6 rows, no music on/off switch', (await rowCount()) === 6 && (await page.locator('[data-setting="music"]').count()) === 0);
  await grp('game');
  check('game: 6 rows (police, hard, blood, street names, map, new game)', (await rowCount()) === 6);
  // Street names (0.10.1): the label under the minimap, on by default, a switch that turns it off.
  check('street names: on by default', (await page.locator('[data-setting="streetLabel"]').getAttribute('aria-checked')) === 'true');
  await page.locator('[data-setting="streetLabel"]').click();
  check('street names: the switch turns it off', (await page.locator('[data-setting="streetLabel"]').getAttribute('aria-checked')) === 'false');
  await page.locator('[data-setting="streetLabel"]').click();
  // Blood (owner decision): on by default, switchable, stored with the other settings.
  check('blood: on by default', (await page.locator('[data-setting="blood"]').getAttribute('aria-checked')) === 'true' && (await page.locator('[data-setting="blood"]').innerText()) === 'On');
  await grp('display');
  // 6 rows: the Phone check (docs/PLAN_V1.md 4.2) and the Sound test join HUD, graphics quality, live day and night and time of day (at most 6)
  check('display: 6 rows (HUD, quality, live time, time of day, Phone check, Sound test)', (await rowCount()) === 6 && (await page.locator('[data-role="phonecheck"]').count()) === 1 && (await page.locator('[data-role="soundtest"]').count()) === 1);
  check('time of day grayed while live is on', await ev(() => document.querySelector('[data-setting="timeOfDay"]').disabled === true));
  // Sound test: the eight numbered sounds of the Phone check, reachable from Settings.
  await page.locator('[data-role="soundtest"]').tap();
  const names = await page.locator('.rw-menu-sounds li').evaluateAll((l) => l.map((e) => e.dataset.sound + ' ' + e.querySelector('b').textContent));
  check('sound test: 8 numbered sounds, same names as the Phone check', JSON.stringify(names) === JSON.stringify(['Engine', 'Tire squeal', 'Gunshot', 'Blast', 'Siren', 'Music', 'Radio', 'Boost whoosh'].map((n, i) => (i + 1) + ' ' + n)), JSON.stringify(names));
  check('sound test: has a Start the Phone check button', (await page.locator('[data-role="phonecheck-start"]').count()) === 1);
  await page.locator('.rw-menu-back').tap();
  check('sound test: Back returns to Settings', (await page.locator('.rw-menu-groups').isVisible()));
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
  // Handling lab: presets, sensitivity, test drive, one-tap verdict (docs/PLAN_V3.md 2.4 item 5).
  await page.locator('[data-role="handlinglab"]').tap();
  check('lab: opens with its own title', (await page.locator('.rw-menu-title').innerText()) === 'Handling lab');
  check('lab: three presets, standard marked by default', (await page.locator('.rw-menu-body [data-preset]').count()) === 3
    && (await page.locator('.rw-menu-body [data-preset="standard"]').getAttribute('aria-checked')) === 'true');
  check('lab: sensitivity slider, test drive button and four verdicts', (await page.locator('.rw-menu-body [data-setting="steerSensitivity"]').count()) === 1
    && (await page.locator('[data-role="labdrive"]').count()) === 1 && (await page.locator('.rw-menu-body [data-verdict]').count()) === 4
    && (await page.locator('.rw-menu-body [data-verdict][aria-checked="true"]').count()) === 0);
  await page.locator('.rw-menu-body [data-preset="sharp"]').tap();
  check('lab: preset saved', (await progress()).settings.handlingPreset === 'sharp' && (await stored()).settings.handlingPreset === 'sharp'
    && (await page.locator('.rw-menu-body [data-preset="sharp"]').getAttribute('aria-checked')) === 'true');
  await page.locator('.rw-menu-body [data-verdict="twitchy"]').tap();
  check('lab: verdict saved and marked', (await progress()).settings.handlingVerdict === 'twitchy' && (await stored()).settings.handlingVerdict === 'twitchy'
    && (await page.locator('.rw-menu-body [data-verdict="twitchy"]').getAttribute('aria-checked')) === 'true');
  await page.screenshot({ path: path.join(out, 'settings-lab-915x412.png') });
  await page.locator('.rw-menu-back').tap();
  check('lab: Back returns to Settings, Controls shows the preset', (await page.locator('.rw-menu-groups').isVisible())
    && (await page.locator('[data-role="handlinglab"]').innerText()) === 'Sharp');
  await ev(() => { window.rw.game.progress.settings.handlingPreset = 'tight'; window.rw.game.events.emit('progress'); });
  await page.locator('[data-role="handlinglab"]').tap();
  check('lab: a bad stored preset reads as standard', (await page.locator('.rw-menu-body [data-preset="standard"]').getAttribute('aria-checked')) === 'true');
  await page.locator('.rw-menu-back').tap();
  await page.locator('[data-setting="invertPitch"]').tap();
  await page.locator('[data-setting="leftHanded"]').tap();
  await grp('game');
  await page.locator('[data-setting="police"]').tap();
  await page.locator('[data-setting="blood"]').tap();
  check('blood: off is stored as false and shown', (await progress()).settings.blood === false && (await page.locator('[data-setting="blood"]').innerText()) === 'Off');
  await page.locator('[data-setting="blood"]').tap();
  check('blood: back on', (await progress()).settings.blood === true);
  await ev(() => { window.rw.game.progress.settings.blood = 'yes'; window.rw.game.events.emit('progress'); });
  check('blood: a bad value reads as on', (await page.locator('[data-setting="blood"]').getAttribute('aria-checked')) === 'true' && (await progress()).settings.blood === undefined);
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
  // 0.9.0 re-pin (deliberate): with no stored choice the current map is the default region, the Beach.
  check('game group: the Map row names the current map', (await page.locator('[data-role="map"]').innerText()).includes('Miami Beach and the Islands'));
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
  // Map choice: one card per region and the island; one tap on another map stores it and reloads behind a veil.
  await page.locator('.rw-menu-back').tap();
  await page.locator('[data-role="map"]').tap();
  // 0.9.0 re-pin (deliberate): the default region, the Beach, is the one marked.
  check('Map choice: five regions and the island, Beach marked', (await page.locator('.rw-mp-card').count()) === 6 && (await page.locator('.rw-mp-card[data-map="miami-beach"]').getAttribute('data-current')) === 'true'
    && (await page.locator('.rw-mp-card[data-current="true"]').count()) === 1);
  const mapNames = await page.locator('.rw-mp-card b').allInnerTexts();
  check('Map choice: clear names', JSON.stringify(mapNames) === JSON.stringify(['Downtown and the Bay', 'Miami Beach and the Islands', 'Wynwood and the North Side', 'Little Havana and Civic Center', 'The Roads and the South Shore', 'Classic island']), JSON.stringify(mapNames));
  const cardBox = await page.locator('.rw-mp-card').first().boundingBox();
  check('Map choice: touch targets 48+', cardBox.height >= 48 && cardBox.width >= 48, JSON.stringify(cardBox));
  await page.screenshot({ path: path.join(out, 'mapchoice-915x412.png') });
  // 0.9.0 re-pin (deliberate): the current map is the Beach now, Downtown the other one.
  await page.locator('[data-role="map-miami-beach"]').tap();
  check('Map choice: the current map does nothing', (await ev(() => localStorage.getItem('rustwater.map'))) === null && (await page.locator('[data-role="map-veil"]').count()) === 0);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.locator('[data-role="map-miami-downtown"]').tap()]);
  await page.waitForFunction(() => window.rw);
  check('Map choice: one tap saves the map and restarts', (await ev(() => localStorage.getItem('rustwater.map'))) === 'miami-downtown');
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
  check('v1 migrates: nothing lost', pr.medals.race_harbor === 'gold' && pr.medals.seen_docks === 'bronze' && pr.medals.hint_car === 'bronze'
    && pr.bestTimes.race_harbor === 70.5 && pr.stats.races === 4 && pr.settings.quality === 0.75 && pr.settings.handling === 'sim' && pr.settings.steering === 'slider', JSON.stringify(pr));

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

  // ---- the loop's screens (docs/LOOP.md sections c, d, f): Records, Daily Three, Customize, the intro tile ----
  await load();
  await ev(() => localStorage.clear());
  await load();
  await ev(() => {
    const L = window.rw.game.progress.loop;
    L.events.ev_beach_trap_1 = { m: 'gold', b: 92.4, n: 3 };
    L.events.ev_beach_miss_1 = { m: 'bronze', b: 3, n: 2 };
    L.events.ev_beach_dash_2 = { m: '', b: 80, n: 1 };
    L.events.ev_north_jump_1 = { m: 'silver', b: 88, n: 1 };
    L.flow.beach = 12450; L.flow.north = 800;
    L.dist.beach = 16093.44; L.dist.north = 1609.344;
    L.totals.banked = 45000; L.best.mph = 97.3; L.best.jumpFt = 118; L.best.tier = 4;
    L.driven.push('sedan', 'muscle');
    window.rw.game.events.emit('progress');
    window.rw.game.paused = true; window.rw.game.events.emit('pause', true);
  });
  const tiles = await ev(() => [...document.querySelectorAll('.rw-menu-tile')].map((b) => b.dataset.role + ':' + b.innerText.replace(/\n/g, ' ')));
  check('hub: Records, Daily Three, Customize and Skip intro tiles', ['records:Records 2 / 12 medals', 'daily:Daily Three 0 / 3 today', 'customize:Customize Paint and wheels, free', 'intro:Skip intro No more guide lines'].every((t) => tiles.includes(t)), JSON.stringify(tiles));
  // Records: the pause button, then the tile: two taps from play.
  await page.locator('[data-role="records"]').tap();
  const recText = await page.locator('.rw-menu-body').innerText();
  check('records: opens from the hub with its title', (await page.locator('.rw-menu-title').innerText()) === 'Records' && (await page.locator('.rw-menu-tab[aria-selected="true"]').innerText()) === 'Resume');
  check('records: twelve tiles, best flow run here and overall, miles', (await page.locator('[data-role="records-stats"] .rw-menu-stat').count()) === 12 && recText.includes('12,450') && recText.includes('10.0 mi') && recText.includes('97 mph') && recText.includes('118 ft') && recText.includes('x4') && /2 \/ 26/.test(recText), recText.slice(0, 400));
  const regions = await ev(() => [...document.querySelectorAll('[data-role="records-regions"] tr')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
  check('records: every region and overall (gold, silver, bronze, best flow, miles)', regions.length === 7 && regions[1] === 'Miami Beach 1 0 1 12,450 10.0' && regions.includes('North Side 0 1 0 800 1.0') && regions[6] === 'Overall 1 1 1 12,450 11.0', JSON.stringify(regions));
  const close3 = await ev(() => [...document.querySelectorAll('.rw-menu-group')].find((g) => g.textContent === 'Closest medals') && [...document.querySelectorAll('.rw-lp-row')].slice(0, 3).map((r) => r.dataset.event + '|' + r.querySelector(':scope > i').textContent));
  check('records: the three closest medals with their next target', close3 && close3[0].startsWith('ev_beach_dash_2|1:20') && /bronze 1:0\d/.test(close3[0]) && close3.length === 3, JSON.stringify(close3));
  check('records: medals by event for all six templates', (await page.locator('.rw-lp-row').count()) === 15 && ['Speed trap  1 / 2', 'Near-miss run  1 / 2', 'Jump  0 / 2', 'Rush drop  0 / 2', 'Heat escape  0 / 2', 'Wrecking spree  0 / 2'].every((t) => recText.replace(/\u00a0/g, ' ').toUpperCase().includes(t.toUpperCase().replace(/\s+/g, ' ')) || recText.toUpperCase().includes(t.toUpperCase())), recText.slice(-600));
  check('records: no flags, no money', !/hint_|seen_|\$|buy/i.test(recText));
  await page.locator('.rw-lp-row [data-role="route"]').first().tap();
  check('records: Route puts the GPS on the gate and resumes', (await ev(() => window.rw.log.tracked)) === 'ev_beach_dash_2' && !(await isOpen()));
  // Daily Three
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  await page.locator('[data-role="daily"]').tap();
  const cards = await ev(() => [...document.querySelectorAll('.rw-lp-card')].map((c) => c.dataset.slot + ':' + c.dataset.done + ':' + c.querySelector('b').textContent));
  check('daily: three cards, one easy, one skill, one mayhem, each with a twist', cards.length === 3 && /^0:false:Easy: (Speed trap|Jump) /.test(cards[0]) && /^1:false:Skill: (Near-miss run|Rush drop) /.test(cards[1]) && /^2:false:Mayhem: (Heat escape|Wrecking spree) /.test(cards[2])
    && cards.every((c) => /( in a | in the | at | under )/.test(c)), JSON.stringify(cards));
  check('daily: days played, and a missed day costs nothing', /Days played: 0\./.test(await page.locator('[data-role="daily-streak"]').innerText()) && /missed day costs nothing/.test(await page.locator('[data-role="daily-msg"]').innerText()));
  await page.locator('.rw-lp-card [data-role="daily-go"]').first().tap();
  const staged = await ev(() => window.rw.log.staged);
  check('daily: Go stages the event and resumes', staged.length === 1 && /^ev_beach_(trap|jump)_/.test(staged[0][0]) && !(await isOpen()), JSON.stringify(staged));
  await ev(() => {
    const g = window.rw.game, p = g.daily.picks[0];
    g.events.emit('streetEventEnd', { id: p.ev.id, medal: 'bronze', daily: 0 });
    g.paused = true; g.events.emit('pause', true);
  });
  check('daily: the hub tile counts it', (await ev(() => document.querySelector('[data-role="daily"]').innerText.replace(/\n/g, ' '))) === 'Daily Three 1 / 3 today');
  await page.locator('[data-role="daily"]').tap();
  check('daily: a finished daily is ticked, the streak is one day, and it is saved', (await ev(() => document.querySelector('.rw-lp-card').dataset.done)) === 'true' && /Days played: 1\./.test(await page.locator('[data-role="daily-streak"]').innerText())
    && (await stored()).loop.daily.streak === 1 && (await stored()).loop.daily.day === 20261123, JSON.stringify((await stored()).loop.daily));
  await page.locator('.rw-menu-back').tap();
  // Customize: on foot it says so; in a car every base option is open and free.
  await page.locator('[data-role="customize"]').tap();
  check('customize: on foot it asks for a car', (await page.locator('[data-role="customize-none"]').count()) === 1);
  await page.locator('[data-role="customize-done"]').tap();
  await ev(() => { window.rw.game.player.vehicle = window.rw.log.car; });
  await page.locator('[data-role="customize"]').tap();
  const cz = await ev(() => ({
    title: document.querySelector('.rw-menu-title').textContent, see: document.querySelector('.rw-menu').classList.contains('rw-menu-see'),
    n: ['paint', 'finish', 'wheels', 'tint', 'decal'].map((k) => document.querySelectorAll('[data-look="' + k + '"] button').length),
    locked: [...document.querySelectorAll('.rw-lp-opts button:disabled')].map((b) => b.textContent),
    main: document.querySelector('.rw-menu-main').getBoundingClientRect().left / innerWidth,
  }));
  check('customize: the car class in the title, 17 paints, 7 finishes, 6 wheels, 4 tints, 5 decals', cz.title === 'Customize: Redtail' && JSON.stringify(cz.n) === '[17,7,6,4,5]', JSON.stringify(cz));
  check('customize: the base set is open; medals open three finishes and one wheel', JSON.stringify(cz.locked) === JSON.stringify(['Pearl (5 medals)', 'Chrome (15 medals)', 'Candy (10 gold medals)', 'Gold (10 medals)']), JSON.stringify(cz.locked));
  check('customize: the menu steps aside so the car shows', cz.see && cz.main > 0.5, JSON.stringify(cz));
  await page.locator('[data-look="paint"] [data-opt="3"]').tap();
  await page.locator('[data-look="finish"] [data-opt="2"]').tap();
  await page.locator('[data-look="wheels"] [data-opt="1"]').tap();
  await page.locator('[data-look="tint"] [data-opt="3"]').tap();
  await page.locator('[data-look="decal"] [data-opt="2"]').tap();
  check('customize: a tap sets the look for the class, marked and saved', JSON.stringify((await stored()).loop.looks) === '{"muscle":{"paint":3,"finish":2,"wheels":1,"tint":3,"decal":2}}'
    && (await page.locator('[data-look="paint"] [data-opt="3"]').getAttribute('aria-checked')) === 'true' && (await page.locator('[data-look="finish"] [data-opt="2"]').getAttribute('aria-checked')) === 'true', JSON.stringify((await stored()).loop.looks));
  check('customize: nothing is for sale', !/\$|buy|price|coins?|credits?/i.test(await page.locator('.rw-menu').innerText()));
  await page.locator('[data-role="look-reset"]').tap();
  check('customize: Back to stock clears the saved look', JSON.stringify((await stored()).loop.looks) === '{}');
  await page.locator('[data-role="customize-done"]').tap();
  check('customize: Done returns to the hub, the menu is whole again', (await page.locator('.rw-menu-title').innerText()) === 'Resume' && !(await ev(() => document.querySelector('.rw-menu').classList.contains('rw-menu-see'))));
  await page.locator('[data-role="intro"]').tap();
  check('intro: Skip intro skips it; the tile then offers Replay intro', (await ev(() => window.rw.log.intro)) === 'skipped' && (await ev(() => document.querySelector('[data-role="intro"]').innerText.replace(/\n/g, ' '))) === 'Replay intro The first five minutes' && (await isOpen()));
  await page.locator('[data-role="intro"]').tap();
  check('intro: Replay intro starts it again and resumes', (await ev(() => window.rw.log.intro)) === 'replayed' && !(await isOpen()));
  // Layout of the three screens at the three sizes: targets 48 or more, nothing off screen; only Records and Customize scroll.
  for (const size of [{ width: 915, height: 412 }, { width: 780, height: 360 }, { width: 748, height: 360 }]) {
    await page.setViewportSize(size);
    await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
    const lay = () => ev(() => {
      const b = document.querySelector('.rw-menu-body');
      const bad = [];
      const br = b.getBoundingClientRect();
      for (const e of document.querySelectorAll('.rw-menu button')) {
        const q = e.getBoundingClientRect();
        if (!q.width) continue;
        if (q.right > innerWidth + 1 || q.left < -1) bad.push('off:' + e.textContent);
        if (q.height < 47.5 || q.width < 47.5) bad.push('small:' + (e.textContent || e.getAttribute('aria-label')) + ':' + Math.round(q.width) + 'x' + Math.round(q.height));
      }
      for (const e of document.querySelectorAll('.rw-lp-row > span, .rw-lp-card b')) if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis') bad.push('clip:' + e.textContent);
      return { bad, over: document.documentElement.scrollWidth > innerWidth, sx: b.scrollWidth > b.clientWidth + 1, sy: b.scrollHeight - b.clientHeight, bot: br.bottom <= innerHeight + 0.5 };
    });
    const hubm = await lay();
    check(`layout hub with the loop tiles ${size.width}: targets 48+, no scroll`, !hubm.bad.length && !hubm.over && !hubm.sx && hubm.sy <= 1 && hubm.bot, JSON.stringify(hubm));
    await page.screenshot({ path: path.join(out, `loop-hub-${size.width}x${size.height}.png`) });
    for (const [role, scrolls] of [['records', true], ['daily', false], ['customize', true]]) {
      await page.locator(`[data-role="${role}"]`).tap();
      const m = await lay();
      check(`layout ${role} ${size.width}: targets 48+, in view, ${scrolls ? 'may scroll' : 'no scroll'}`, !m.bad.length && !m.over && !m.sx && (scrolls || m.sy <= 1) && m.bot, JSON.stringify(m));
      await page.screenshot({ path: path.join(out, `loop-${role}-${size.width}x${size.height}.png`) });
      await page.locator(role === 'customize' ? '[data-role="customize-done"]' : '.rw-menu-back').tap();
    }
    await ev(() => { window.rw.menu.close(); });
  }
  await page.setViewportSize({ width: 915, height: 412 });
  await ev(() => { window.rw.game.player.vehicle = null; });

  // Smaller phone: every screen at both sizes, every group; rows 48 px or more; nothing scrolls except Help.
  for (const size of [{ width: 915, height: 412 }, { width: 780, height: 360 }, { width: 748, height: 360 }]) {
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
    // Accessibility (0.13.0): its own screen from the Access button in the Settings head; targets 48+, no scroll.
    await page.locator('[data-role="access"]').tap();
    const mAcc = await probe();
    check(`layout accessibility ${size.width}: 4 rows, targets 48+, in view, no scroll`, (await rowCount()) === 4 && !mAcc.bad.length && !mAcc.over && !mAcc.sx && mAcc.sy <= 1 && mAcc.bot, JSON.stringify(mAcc));
    if (size.width === 915) {
      await page.locator('[data-textsize="large"]').tap();
      await page.locator('[data-setting="reduceMotion"]').tap();
      await page.locator('[data-setting="highContrast"]').tap();
      await page.locator('[data-setting="colorSafe"]').tap();
      const st = (await progress()).settings;
      const at = await ev(() => [document.documentElement.dataset.rwText, document.documentElement.dataset.rwContrast, document.documentElement.dataset.rwCalm, document.documentElement.style.getPropertyValue('--rw-text-scale')]);
      check('accessibility: each setting is saved and applied at once', st.textSize === 'large' && st.reduceMotion === true && st.highContrast === true && st.colorSafe === true && JSON.stringify(at) === JSON.stringify(['large', 'high', 'on', '1.15']), JSON.stringify([st, at]));
      const mb = await probe();
      check('layout accessibility large text: nothing off screen, no scroll', !mb.bad.length && !mb.over && mb.sy <= 1, JSON.stringify(mb));
      await page.locator('[data-textsize="normal"]').tap();
      for (const k of ['reduceMotion', 'highContrast', 'colorSafe']) await page.locator(`[data-setting="${k}"]`).tap();
      const st2 = (await progress()).settings;
      check('accessibility: back to defaults', st2.textSize === 'normal' && !st2.reduceMotion && !st2.highContrast && !st2.colorSafe, JSON.stringify(st2));
    }
    await page.locator('.rw-menu-back').tap();
    await tab('Help');
    for (const role of ['about']) {
      await page.locator(`[data-role="${role}"]`).tap();
      const m = await probe();
      check(`layout ${role} screen ${size.width}: targets 48+, in view`, !m.bad.length && !m.over && !m.sx, JSON.stringify(m));
      await page.screenshot({ path: path.join(out, `${role}-${size.width}x${size.height}.png`) });
      await page.locator('.rw-menu-back').tap();
    }
    await tab('Settings');
    await grp('display');
    await page.locator('[data-role="soundtest"]').tap();
    const mst = await probe();
    check(`layout sound test ${size.width}: targets 48+, no scroll`, !mst.bad.length && !mst.over && !mst.sx && mst.sy <= 1, JSON.stringify(mst));
    await page.screenshot({ path: path.join(out, `soundtest-${size.width}x${size.height}.png`) });
    await page.locator('.rw-menu-back').tap();
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

// The map screen in the real game (NAV, docs/PLAN_V3.md 2.7): zoom buttons, the north-up switch, street names,
// tap to route (line, summary, HUD turn strip), hold to clear. The Beach region, 915x412 and 780x360.
// Runs on its own page, so a failure above does not hide it.
try {
  await mapScreen();
} catch (e) {
  failures.push('map screen exception: ' + (e && e.stack || e));
}

if (failures.length) {
  console.error(`menu-test FAILED (${failures.length} of ${checks}):\n- ` + failures.join('\n- '));
  process.exit(1);
}
console.log(`menu-test ok: ${checks} checks, screenshots in dist/menu-test/`);
