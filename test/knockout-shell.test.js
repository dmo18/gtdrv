// The knockout fade keeps its element out of display none, and a startup
// error after the shell was told "ok" is written to the message line (0.14.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setAriaShown } from '../src/ui/combathud.js';

test('setAriaShown never sets hidden and flips only aria-hidden', () => {
  const attrs = {};
  const el = { hidden: true, setAttribute: (k, v) => { attrs[k] = v; } };
  setAriaShown(el, false);
  assert.equal(el.hidden, false, 'no display none: the opacity fade can run');
  assert.equal(attrs['aria-hidden'], 'true', 'out of the accessibility tree when inactive');
  setAriaShown(el, true);
  assert.equal(el.hidden, false);
  assert.equal(attrs['aria-hidden'], 'false');
  setAriaShown(null, true);
});

test('the knocked-out text uses the aria-only toggle', () => {
  const src = readFileSync(new URL('../src/ui/combathud.js', import.meta.url), 'utf8');
  assert.ok(!/setShown\(\s*(ui\.)?fadeText/.test(src));
  assert.ok(/setAriaShown\(ui\.fadeText, downText\)/.test(src));
});

test('main.js writes a post-ok startup error to the visible message', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(src, /if \(name === '__rwOk'\) shellOk = true;/);
  const i = src.indexOf('startUp().catch');
  const body = src.slice(i, src.indexOf('});', i));
  assert.match(body, /__rwFail === 'function' && !shellOk/);
  assert.match(body, /else msg\.textContent = failureMessage/);
});
