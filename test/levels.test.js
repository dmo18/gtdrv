import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryLevels, volumeFromSettings, BUS_CATEGORY } from '../src/audio/levels.js';
import { sanitizeProgress, defaultProgress } from '../src/core/save.js';

const base = { master: 0.8, music: 0.5, sfx: 0.7, ambience: 0.6, musicOn: true, muteAll: false };
const cats = ['music', 'effects', 'ambience'];

test('master 0 silences every category, music included', () => {
  const L = categoryLevels({ ...base, master: 0 });
  assert.equal(L.master, 0);
  for (const c of cats) assert.equal(L.effective[c], 0);
});

test('effective level is master times category', () => {
  const L = categoryLevels(base);
  assert.ok(Math.abs(L.effective.music - 0.4) < 1e-12);
  assert.ok(Math.abs(L.effective.effects - 0.56) < 1e-12);
  assert.ok(Math.abs(L.effective.ambience - 0.48) < 1e-12);
});

test('each category slider only affects its own category', () => {
  const ref = categoryLevels(base);
  for (const [key, cat] of [['music', 'music'], ['sfx', 'effects'], ['ambience', 'ambience']]) {
    const L = categoryLevels({ ...base, [key]: 0 });
    for (const c of cats) {
      if (c === cat) assert.equal(L.effective[c], 0);
      else assert.equal(L.effective[c], ref.effective[c]);
    }
    assert.equal(L.master, ref.master);
  }
});

test('music switch off only silences music', () => {
  const L = categoryLevels({ ...base, musicOn: false });
  assert.equal(L.effective.music, 0);
  assert.ok(L.effective.effects > 0 && L.effective.ambience > 0);
});

test('mute overrides everything and keeps the sliders', () => {
  for (const L of [categoryLevels({ ...base, muteAll: true }), categoryLevels(base, true)]) {
    assert.equal(L.master, 0);
    for (const c of cats) assert.equal(L.effective[c], 0);
  }
  assert.equal(categoryLevels({ ...base, muteAll: true }).music, 0.5);
});

test('junk input falls back to defaults and stays in range', () => {
  const L = categoryLevels({ master: NaN, music: 9, sfx: -3, ambience: 'x' });
  assert.equal(L.master, 0.8);
  assert.equal(L.music, 1);
  assert.equal(L.effects, 0);
  assert.equal(L.ambience, 1);
});

test('every bus belongs to a category', () => {
  for (const k of ['music', 'world', 'engine', 'tires', 'effects', 'ui']) assert.ok(cats.includes(BUS_CATEGORY[k]), k);
  assert.equal(BUS_CATEGORY.world, 'ambience');
  assert.equal(BUS_CATEGORY.music, 'music');
});

test('volumeFromSettings handles old saves', () => {
  const v = volumeFromSettings({ master: 0.3 });
  assert.deepEqual(v, { master: 0.3, musicOn: true, music: 0.5, sfx: 1, ambience: 1, muteAll: false });
  const w = volumeFromSettings({ master: 1, music: false, musicVol: 0.2, sfxVol: 0.4, ambVol: 0.1, muteAll: true });
  assert.deepEqual(w, { master: 1, musicOn: false, music: 0.2, sfx: 0.4, ambience: 0.1, muteAll: true });
});

test('save sanitiser: new volume fields clamp and reject junk', () => {
  const load = (settings) => sanitizeProgress({ ...defaultProgress(), settings }).settings;
  const a = load({ sfxVol: 5, ambVol: -2, muteAll: true });
  assert.equal(a.sfxVol, 1);
  assert.equal(a.ambVol, 0);
  assert.equal(a.muteAll, true);
  const b = load({ sfxVol: 'loud', ambVol: NaN, muteAll: 'yes' });
  assert.ok(!('sfxVol' in b) && !('ambVol' in b) && !('muteAll' in b));
  const c = load({ sfxVol: 0.25, ambVol: 0.5 });
  assert.equal(c.sfxVol, 0.25);
  assert.equal(c.ambVol, 0.5);
  assert.ok(!('muteAll' in load({ master: 0.5 })));
});
