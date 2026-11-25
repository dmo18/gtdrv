import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeProgress, defaultProgress, loadProgress, saveProgress, SAVE_KEY } from '../src/core/save.js';
import { sanitizeAccess, textScale, isCalm, markerLook, applyAccess, SAFE_COLORS, ACCESS_DEFAULTS } from '../src/core/access.js';

const san = (settings) => sanitizeProgress({ version: 3, settings }).settings;

test('default progress has no accessibility switch on', () => {
  const s = defaultProgress().settings;
  for (const k of ['reduceMotion', 'highContrast', 'colorSafe']) assert.notEqual(s[k], true);
  assert.notEqual(s.textSize, 'large');
  assert.deepEqual(ACCESS_DEFAULTS, { textSize: 'normal', reduceMotion: false, highContrast: false, colorSafe: false });
});

test('sanitizer keeps valid values', () => {
  const s = san({ textSize: 'large', reduceMotion: true, highContrast: true, colorSafe: true });
  assert.equal(s.textSize, 'large');
  assert.deepEqual([s.reduceMotion, s.highContrast, s.colorSafe], [true, true, true]);
});

test('sanitizer rejects wrong types and values', () => {
  for (const bad of ['huge', 'LARGE', 2, true, null, {}, ['large']]) assert.notEqual(san({ textSize: bad }).textSize, bad);
  for (const k of ['reduceMotion', 'highContrast', 'colorSafe']) {
    for (const bad of ['true', 1, 'yes', null, {}, []]) assert.equal(san({ [k]: bad })[k], undefined, k);
  }
  assert.deepEqual(sanitizeAccess(null, { a: 1 }), { a: 1 });
});

test('settings survive a save and a load', () => {
  const m = new Map();
  const st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  const p = defaultProgress();
  Object.assign(p.settings, { textSize: 'large', reduceMotion: true, highContrast: true, colorSafe: true });
  assert.equal(saveProgress(st, p), true);
  assert.equal(JSON.parse(m.get(SAVE_KEY)).settings.textSize, 'large');
  const q = loadProgress(st).settings;
  assert.equal(q.textSize, 'large');
  assert.equal(q.reduceMotion && q.highContrast && q.colorSafe, true);
});

test('text scale and calm helpers', () => {
  assert.equal(textScale({ textSize: 'large' }) > 1, true);
  assert.equal(textScale({}), 1);
  assert.equal(textScale(undefined), 1);
  assert.equal(isCalm({ reduceMotion: true }), true);
  assert.equal(isCalm({ reduceMotion: 'true' }), false);
});

test('color-safe markers add a shape and a new color; off changes nothing', () => {
  const plain = markerLook('next', false, 0xff8a4a);
  assert.deepEqual(plain, { color: 0xff8a4a, arrow: false, arrowScale: 1, wide: 1 });
  const next = markerLook('next', true, 0xff8a4a), after = markerLook('after', true, 0xf6efe6), fin = markerLook('finish', true, 0xfff3c4);
  assert.equal(next.color, SAFE_COLORS.next);
  assert.equal(next.arrow && fin.arrow, true);
  assert.equal(after.arrow, false);
  assert.ok(fin.arrowScale > next.arrowScale);
  assert.equal(new Set([next.color, after.color, fin.color]).size, 3);
});

test('applyAccess sets the root attributes and the camera shake, and works without them', () => {
  const root = { style: { vars: {}, setProperty(k, v) { this.vars[k] = v; } }, dataset: {} };
  const shakes = [];
  const game = { chase: { setShake: (k) => shakes.push(k) } };
  applyAccess({ textSize: 'large', reduceMotion: true, highContrast: true }, root, game);
  assert.equal(root.style.vars['--rw-text-scale'], '1.15');
  assert.deepEqual([root.dataset.rwText, root.dataset.rwContrast, root.dataset.rwCalm], ['large', 'high', 'on']);
  assert.deepEqual(shakes, [0]);
  applyAccess({}, root, game);
  assert.deepEqual([root.dataset.rwText, root.dataset.rwContrast, root.dataset.rwCalm, shakes[1]], ['normal', 'normal', 'off', 1]);
  assert.doesNotThrow(() => applyAccess({}, null, {}));
});
