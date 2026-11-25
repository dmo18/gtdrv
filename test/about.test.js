// The About page states the store facts and the map attribution; the
// privacy contact stays the placeholder literal until the owner replaces it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillAbout, MAP_CREDIT } from '../src/ui/title.js';

function fakeDoc() {
  return { createElement: (tag) => ({ tag, dataset: {}, children: [], appendChild(c) { this.children.push(c); }, textContent: '' }) };
}

test('About says original, offline, no ads, no purchases, and credits OpenStreetMap (ODbL)', () => {
  const root = fakeDoc().createElement('div');
  fillAbout(fakeDoc(), root, { version: '1.2.3' });
  const text = root.children.map((c) => c.textContent).join('\n');
  assert.match(text, /original game/);
  assert.match(text, /offline/);
  assert.match(text, /no ads/);
  assert.match(text, /no purchases/);
  assert.match(text, /OpenStreetMap/);
  assert.match(text, /ODbL|Open Database License/);
  assert.match(MAP_CREDIT, /OpenStreetMap contributors, ODbL/);
  assert.match(text, /Version 1.2.3/);
});

test('privacy page keeps the contact placeholder literal', () => {
  const html = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
  assert.ok(html.includes('PRIVACY_EMAIL_PLACEHOLDER'));
});
