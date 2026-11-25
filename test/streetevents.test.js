import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATES, TEMPLATE_INFO, trapTargets, missTargets, jumpTargets, jumpDistance, dashTargets, dashLimit, heatTargets, wreckTargets,
  refSpeed, medalFor, better, valueText, eventPoints, createEventRun, statusLine, statusKey, startLine, resultLine, mph, markMedal,
  TRAP_CAP, MISS_LIMIT, WRECK_LIMIT, HEAT_COOL, DASH_ARRIVE, END_HOLD,
} from '../src/core/streetevents.js';
import { COOLDOWN } from '../src/systems/police.js';

const DT = 1 / 60;
const facts = (o = {}) => ({ x: 0, z: 0, px: 0, pz: 0, speed: 20, inCar: true, wrecked: false, passes: 0, smashes: 0, jump: 0, escaped: false, busted: false, stars: 0, ...o });
const ev = (tpl, o = {}) => ({ id: 'ev_beach_' + tpl + '_1', tpl, x: 0, z: 0, dx: 1, dz: 0, w: 5, limit: 30, targets: { gold: 3, silver: 2, bronze: 1 }, ...o });

test('six templates, each with a title, a color and a map icon', () => {
  assert.equal(TEMPLATES.length, 6);
  for (const t of TEMPLATES) {
    assert.ok(TEMPLATE_INFO[t].title && /^#[0-9a-f]{6}$/.test(TEMPLATE_INFO[t].color) && TEMPLATE_INFO[t].icon);
  }
});

test('targets come from formulas: ordered, whole numbers, sensible sizes', () => {
  const up = (t) => t.gold > t.silver && t.silver > t.bronze && [t.gold, t.silver, t.bronze].every(Number.isInteger);
  const down = (t) => t.gold < t.silver && t.silver < t.bronze && [t.gold, t.silver, t.bronze].every(Number.isInteger);
  const trap = trapTargets(300);
  assert.ok(up(trap));
  // 300 m of run-up from 13 m/s at 2.6 m/s2 is 41.6 m/s: gold at 92 percent of it, in mph
  assert.equal(trap.gold, Math.round(mph(Math.sqrt(13 * 13 + 2 * 2.6 * 300)) * 0.92));
  assert.ok(trapTargets(5000).gold <= Math.round(mph(TRAP_CAP) * 0.92), 'capped');
  assert.ok(trapTargets(420).gold >= trapTargets(260).gold);
  assert.deepEqual(missTargets(MISS_LIMIT, 1), { gold: 7, silver: 5, bronze: 3 });
  assert.deepEqual(missTargets(MISS_LIMIT, 0.75), { gold: 5, silver: 3, bronze: 2 });
  assert.ok(up(wreckTargets(WRECK_LIMIT, 1)) && wreckTargets(WRECK_LIMIT, 1).gold === 12);
  const angle = Math.atan2(1.5, 6);
  const jump = jumpTargets(95, angle, 1.5);
  assert.ok(up(jump) && jump.bronze >= 30 && jump.gold <= 200, JSON.stringify(jump));
  // the flight formula: a faster car flies farther, and 25 m/s off this ramp is about 37 m
  assert.ok(jumpDistance(25, angle, 1.5) > jumpDistance(20, angle, 1.5));
  assert.ok(Math.abs(jumpDistance(25, angle, 1.5) - 37) < 2);
  const dash = dashTargets(600);
  assert.ok(down(dash));
  assert.equal(dash.gold, Math.round(6 + 600 / 17));
  assert.ok(dashLimit(dash) > dash.bronze && dashLimit(dashTargets(5000)) <= 90);
  for (const lv of [1, 2, 3]) {
    const h = heatTargets(lv);
    assert.ok(down(h));
    assert.ok(h.gold > HEAT_COOL[lv] && h.bronze < 90, 'gold is possible, bronze fits the limit');
    assert.equal(HEAT_COOL[lv], COOLDOWN[lv], 'the same seconds out of sight as the police rules');
  }
  assert.ok(refSpeed(0, 50) === 13 && refSpeed(1e6, 30) === 30);
});

test('medals: more is better or less is better by template', () => {
  const t = ev('trap', { targets: { gold: 80, silver: 68, bronze: 54 } });
  assert.equal(medalFor(t, 81), 'gold');
  assert.equal(medalFor(t, 80), 'gold');
  assert.equal(medalFor(t, 70), 'silver');
  assert.equal(medalFor(t, 54), 'bronze');
  assert.equal(medalFor(t, 53.9), null);
  assert.equal(medalFor(t, NaN), null);
  const d = ev('dash', { targets: { gold: 40, silver: 50, bronze: 64 } });
  assert.equal(medalFor(d, 39), 'gold');
  assert.equal(medalFor(d, 50), 'silver');
  assert.equal(medalFor(d, 64.1), null);
  assert.ok(better('trap', 80, 70) && !better('trap', 70, 80) && better('trap', 1, NaN));
  assert.ok(better('dash', 40, 50) && !better('dash', 50, 40));
  assert.equal(valueText('trap', 80.6), '81 mph');
  assert.equal(valueText('jump', 118.2), '118 ft');
  assert.equal(valueText('dash', 72), '1:12');
  assert.equal(valueText('miss', 5), '5');
  assert.equal(eventPoints('gold', true), 3500);
  assert.equal(eventPoints('bronze', false), 1000);
  assert.equal(eventPoints(null, true), 0, 'no medal, no points');
});

test('speed trap: the speed at the line, in mph; too late fails', () => {
  const run = createEventRun();
  const e = ev('trap', { tx: 100, tz: 0, limit: 5, targets: { gold: 60, silver: 50, bronze: 40 } });
  run.start(e);
  assert.equal(run.step(DT, facts({ x: 50, px: 49 })), '');
  assert.equal(run.step(DT, facts({ x: 100.2, px: 99.8, speed: 30 })), 'done');
  assert.equal(Math.round(run.value), 67);
  assert.equal(run.medal, 'gold');
  // beside the street: not through the line
  run.start(e);
  assert.equal(run.step(DT, facts({ x: 100.2, px: 99.8, z: 30, pz: 30 })), '');
  // against the direction: no
  assert.equal(run.step(DT, facts({ x: 99.8, px: 100.2 })), '');
  let r = '';
  for (let i = 0; i < 400 && !r; i++) r = run.step(DT, facts({ x: 10, px: 10 }));
  assert.equal(r, 'fail');
  assert.equal(run.why, 'Out of time');
  assert.equal(run.medal, null);
});

test('near-miss run and wrecking spree: counts over the time, an early end at gold', () => {
  const run = createEventRun();
  const e = ev('miss', { limit: 2, targets: { gold: 3, silver: 2, bronze: 1 } });
  run.start(e);
  run.step(DT, facts({ passes: 1 }));
  assert.equal(run.count, 1);
  let r = '';
  for (let i = 0; i < 200 && !r; i++) r = run.step(DT, facts());
  assert.equal(r, 'done');
  assert.equal(run.medal, 'bronze');
  assert.ok(Math.abs(run.t - 2) < 0.05);
  run.start(e);
  run.step(DT, facts({ passes: 3 }));
  r = '';
  let n = 0;
  for (; n < 200 && !r; n++) r = run.step(DT, facts());
  assert.equal(r, 'done');
  assert.equal(run.medal, 'gold');
  assert.ok(n * DT < END_HOLD + 0.1, 'gold ends the run at once');
  const w = createEventRun();
  w.start(ev('wreck', { limit: 1, targets: { gold: 9, silver: 6, bronze: 4 } }));
  w.step(DT, facts({ smashes: 3 }));
  w.step(DT, facts({ smashes: 2 }));
  r = '';
  for (let i = 0; i < 100 && !r; i++) r = w.step(DT, facts());
  assert.equal(w.value, 5);
  assert.equal(w.medal, 'bronze');
});

test('jump: a landed distance in feet; a bad landing fails', () => {
  const run = createEventRun();
  const e = ev('jump', { targets: { gold: 110, silver: 80, bronze: 55 } });
  run.start(e);
  assert.equal(run.step(DT, facts({ jump: 30 })), 'done');
  assert.equal(Math.round(run.value), 98);
  assert.equal(run.medal, 'silver');
  run.start(e);
  assert.equal(run.step(DT, facts({ jump: -1 })), 'fail');
  assert.equal(run.why, 'Bad landing');
});

test('rush drop: the time to the drop point', () => {
  const run = createEventRun();
  const e = ev('dash', { tx: 300, tz: 40, limit: 60, targets: { gold: 2, silver: 4, bronze: 6 } });
  run.start(e);
  for (let i = 0; i < 180; i++) assert.equal(run.step(DT, facts({ x: 100, z: 0 })), '');
  assert.equal(run.step(DT, facts({ x: 300 - DASH_ARRIVE + 1, z: 40 })), 'done');
  assert.ok(Math.abs(run.value - 181 / 60) < 1e-6);
  assert.equal(run.medal, 'silver');
});

test('heat escape: done when the stars are gone after they came; a bust fails', () => {
  const run = createEventRun();
  const e = ev('heat', { level: 2, limit: 90, targets: heatTargets(2) });
  run.start(e);
  assert.equal(run.step(DT, facts({ stars: 0 })), '', 'the stars come one step later');
  for (let i = 0; i < 600; i++) assert.equal(run.step(DT, facts({ stars: 2 })), '');
  assert.equal(run.step(DT, facts({ stars: 0, escaped: true })), 'done');
  assert.equal(run.medal, 'gold');
  run.start(e);
  run.step(DT, facts({ stars: 2 }));
  assert.equal(run.step(DT, facts({ stars: 0, busted: true })), 'fail');
  assert.equal(run.why, 'Pulled over');
});

test('leaving the car or wrecking it ends any event', () => {
  for (const tpl of TEMPLATES) {
    const run = createEventRun();
    run.start(ev(tpl, { tx: 500, tz: 0 }));
    assert.equal(run.step(DT, facts({ inCar: false })), 'fail');
    run.start(ev(tpl, { tx: 500, tz: 0 }));
    assert.equal(run.step(DT, facts({ wrecked: true })), 'fail');
    assert.equal(run.abort(), '');
  }
});

test('lines: one short line each, US units, no step allocates a new line unless the key moved', () => {
  const run = createEventRun();
  for (const tpl of TEMPLATES) {
    const e = ev(tpl, { tx: 200, tz: 0, to: 'Lincoln Rd', targets: tpl === 'dash' || tpl === 'heat' ? { gold: 30, silver: 40, bronze: 50 } : { gold: 78, silver: 66, bronze: 52 } });
    run.start(e);
    const line = statusLine(run, 120);
    assert.ok(line.length > 0 && line.length <= 30, tpl + ': ' + line);
    assert.ok(!/\bm\b|km\/h|metres|meters/.test(line), line);
    assert.ok(startLine(e).split(' ').length <= 9, startLine(e));
    const k = statusKey(run, 120);
    assert.equal(statusKey(run, 120.4), k, 'the key holds between whole steps of the shown numbers');
    run.step(DT, facts({ jump: tpl === 'jump' ? 30 : 0, x: tpl === 'dash' ? 200 : 0, px: -1, passes: 99, smashes: 99, stars: 0 }));
  }
  const t = createEventRun();
  t.start(ev('trap', { tx: 10, tz: 0, targets: { gold: 80, silver: 68, bronze: 54 } }));
  t.step(DT, facts({ x: 10.1, px: 9.9, speed: 31.3 }));
  assert.equal(resultLine(t), 'Silver! 70 mph (gold 80 mph)');
  assert.equal(statusLine(t, 0), '');
  assert.equal(statusKey(t, 0), -1);
});

test('the running line shows the next medal: in a trap the one above the speed, in a drop or an escape the best the clock allows', () => {
  const run = createEventRun();
  const T = { gold: 80, silver: 68, bronze: 54 };
  run.start(ev('trap', { tx: 500, tz: 0, targets: T }));
  const lineAt = (mphNow) => {
    run.step(DT, facts({ x: 0, px: -0.1, speed: mphNow / mph(1) }));
    return [markMedal(run), statusLine(run, 300), statusKey(run, 300)];
  };
  const a = lineAt(40), b = lineAt(60), c = lineAt(75), d = lineAt(85);
  assert.deepEqual([a[0], b[0], c[0], d[0]], ['bronze', 'silver', 'gold', 'gold']);
  assert.equal(a[1], 'Trap 984 ft · bronze 54 mph');
  assert.equal(b[1], 'Trap 984 ft · silver 68 mph');
  assert.equal(d[1], 'Trap 984 ft · gold 80 mph');
  assert.ok(a[2] !== b[2] && b[2] !== c[2] && c[2] === d[2], 'the key moves with the medal shown, so the line is rebuilt');
  for (const tpl of ['dash', 'heat']) {
    const r = createEventRun();
    r.start(ev(tpl, { tx: 5000, tz: 0, limit: 90, targets: { gold: 30, silver: 40, bronze: 50 } }));
    const seen = [];
    let key = -2;
    for (let i = 0; i < 60 * 55; i++) {
      r.step(DT, facts({ x: 0, px: 0, stars: 1 }));
      const k = statusKey(r, 900);
      if (k !== key) { key = k; seen.push(statusLine(r, 900)); }
      // the medal shown is always the one stopping now would earn (or bronze, once past it)
      const m = markMedal(r);
      assert.equal(m, medalFor(r.ev, r.t) || 'bronze', tpl + ' at ' + r.t.toFixed(2));
    }
    const pre = tpl === 'heat' ? 'Lose them ' : '';
    assert.ok(seen.includes(pre + '0:29 · gold 0:30'), seen.join(' | '));
    assert.ok(seen.includes(pre + '0:31 · silver 0:40'), seen.join(' | '));
    assert.ok(seen.includes(pre + '0:45 · bronze 0:50'), seen.join(' | '));
    assert.ok(seen.every((l) => l.length <= 30), 'short lines');
  }
});
