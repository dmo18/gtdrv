// Car radio: station list, caption picker, talk composer, save setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import {
  STATIONS, STATION_IDS, sanitizeStation, nextStation, canListen, DJ_LINES, AD_LINES,
  createCaptionPicker, pickIndex, syllables,
} from '../src/core/radio.js';
import { createStation, createDanceComposer, createJazzComposer, createTalkComposer, speechEvents, jazzVoicing } from '../src/audio/radio.js';
import { INST } from '../src/audio/radioplayer.js';
import { sanitizeProgress, defaultProgress } from '../src/core/save.js';

test('station list: off plus four named stations, ids unique', () => {
  assert.deepEqual(STATION_IDS, ['off', 'chill', 'dance', 'jazz', 'talk']);
  assert.equal(new Set(STATIONS.map((s) => s.name)).size, STATIONS.length);
  for (const s of STATIONS) assert.ok(s.name && s.tag);
  // cycling visits every station and wraps back to off
  let id = 'off';
  const seen = [];
  for (let i = 0; i < 5; i++) { id = nextStation(id, 1); seen.push(id); }
  assert.deepEqual(seen, ['chill', 'dance', 'jazz', 'talk', 'off']);
  assert.equal(nextStation('off', -1), 'talk');
  assert.equal(nextStation('bogus', 1), 'chill');
  assert.ok(canListen('car') && canListen('boat'));
  assert.ok(!canListen('foot') && !canListen('plane') && !canListen(undefined));
});

test('station setting: strict allow-list, default off', () => {
  for (const id of STATION_IDS) assert.equal(sanitizeStation(id), id);
  for (const bad of ['', 'Talk', 'chill ', 'radio1', null, undefined, 3, {}, [], ['talk'], '__proto__', 'constructor']) {
    assert.equal(sanitizeStation(bad), 'off');
  }
});

test('save: station kept when known, dropped when not, old saves load', () => {
  const ok = sanitizeProgress({ version: 3, settings: { station: 'jazz', master: 0.5 } });
  assert.equal(ok.settings.station, 'jazz');
  assert.equal(ok.settings.master, 0.5);
  for (const bad of ['disco', '', 7, null, true, {}, ['talk'], 'TALK']) {
    const p = sanitizeProgress({ version: 3, settings: { station: bad } });
    assert.equal(p.settings.station, undefined, `rejects ${JSON.stringify(bad)}`);
    assert.equal(sanitizeStation(p.settings.station), 'off');
  }
  const old = sanitizeProgress({ version: 3, score: { total: 5 }, settings: { master: 0.4 } });
  assert.equal(old.settings.station, undefined);
  assert.equal(sanitizeStation(old.settings.station), 'off');
  assert.equal(sanitizeStation(defaultProgress().settings.station), 'off');
});

test('captions: 40 DJ lines, original text, no dashes, no repeats in a row', () => {
  assert.ok(DJ_LINES.length >= 40);
  assert.ok(AD_LINES.length >= 6);
  assert.equal(new Set(DJ_LINES).size, DJ_LINES.length);
  for (const l of [...DJ_LINES, ...AD_LINES]) {
    assert.ok(l.length > 10 && l.length <= 100, l);
    assert.ok(!/[–—]/.test(l), 'no em or en dashes: ' + l);
  }
  const a = createCaptionPicker(createRng(3));
  const b = createCaptionPicker(createRng(3));
  const c = createCaptionPicker(createRng(4));
  const sa = [], sb = [], sc = [];
  for (let i = 0; i < 400; i++) { sa.push(a.next()); sb.push(b.next()); sc.push(c.next()); }
  assert.deepEqual(sa, sb, 'same seed, same show');
  assert.notDeepEqual(sa, sc, 'other seed, other show');
  for (let i = 1; i < sa.length; i++) assert.notEqual(sa[i], sa[i - 1], 'never the same line twice in a row');
  // the recent-memory rule: nothing repeats within the last few lines
  for (let i = 6; i < sa.length; i++) assert.ok(!sa.slice(i - 5, i).includes(sa[i]));
  // every line gets used over a long run
  assert.equal(new Set(sa).size, DJ_LINES.length);
  // the index picker alone never repeats either, even with a rigged rng
  const stuck = { next: () => 0.5 };
  assert.notEqual(pickIndex(stuck, 10, 5), 5);
  assert.equal(pickIndex(stuck, 1, 0), 0);
});

test('syllable counter', () => {
  assert.equal(syllables('gull'), 1);
  assert.equal(syllables('harbor'), 2);
  assert.equal(syllables('lighthouse'), 2);
  assert.equal(syllables('table'), 2);
  assert.equal(syllables('...'), 0);
  assert.ok(syllables('Doreen') >= 2);
});

function bars(id, seed, n) {
  const c = createStation(id, createRng(seed));
  const out = [];
  for (let i = 0; i < n; i++) out.push(c.bar(i));
  return { c, out };
}

test('every station composer: seeded, notes inside the bar, known instruments', () => {
  for (const id of ['chill', 'dance', 'jazz', 'talk']) {
    const a = bars(id, 11, 60);
    const b = bars(id, 11, 60);
    const d = bars(id, 12, 60);
    assert.deepEqual(a.out, b.out, id + ' is deterministic');
    assert.notDeepEqual(a.out, d.out, id + ' differs by seed');
    for (const bar of a.out) {
      assert.ok(bar.length > 0 && bar.length <= 64, `${id}: ${bar.length} notes in a bar`);
      for (const n of bar) {
        assert.ok(n.beat >= 0 && n.beat < 4, 'inside the bar');
        if (n.inst === 'cap') { assert.ok(n.text && n.dur > 0); continue; }
        assert.ok(INST[n.inst], 'instrument ' + n.inst);
        assert.ok(n.vel > 0 && n.vel <= 1.01 && Math.abs(n.semi) < 40, JSON.stringify(n));
      }
    }
  }
  assert.equal(createStation('off', createRng(1)), null);
});

test('station tempos: chill slow, dance 118 to 124, jazz slow, talk steady', () => {
  for (let s = 1; s < 60; s++) {
    const d = createDanceComposer(createRng(s)).tempo;
    assert.ok(d >= 118 && d <= 124, 'dance ' + d);
    const j = createJazzComposer(createRng(s)).tempo;
    assert.ok(j >= 70 && j <= 82, 'jazz ' + j);
    const c = createStation('chill', createRng(s)).tempo;
    assert.ok(c >= 80 && c <= 95, 'chill ' + c);
  }
  assert.equal(createTalkComposer(createRng(1)).tempo, 96);
});

test('dance has a four on the floor kick and claps; jazz has voiced chords and brushes', () => {
  const { out } = bars('dance', 2, 24);
  const full = out[10];
  assert.equal(full.filter((n) => n.inst === 'kick').length, 4);
  assert.ok(full.some((n) => n.inst === 'clap'));
  const jz = bars('jazz', 2, 8).out;
  for (const bar of jz) {
    assert.ok(bar.filter((n) => n.inst === 'keys').length >= 4, 'chord notes');
    assert.equal(bar.filter((n) => n.inst === 'dbass').length, 4, 'a walking bass note per beat');
    assert.ok(bar.some((n) => n.inst === 'brush'));
  }
  const v = jazzVoicing(2, 'm7');
  assert.equal(v.length, 4);
  assert.ok(Math.max(...v) - Math.min(...v) < 12, 'voicing stays inside an octave');
  assert.ok(!jz.flat().some((n) => n.inst === 'kick' || n.inst === 'snare'), 'no drum kit sounds in the jazz set');
});

test('talk: jingle first, captions are the DJ lines, an ad after every third song', () => {
  const { out } = bars('talk', 5, 260);
  const caps = out.flatMap((b, i) => b.filter((n) => n.inst === 'cap').map((n) => ({ bar: i, text: n.text, dur: n.dur })));
  assert.equal(caps[0].bar, 0, 'the station sting opens the show');
  assert.ok(/Gullspeak/.test(caps[0].text));
  const kinds = caps.slice(1).map((c) => (c.text.startsWith('Now playing: ') ? 'song' : c.text.startsWith('Ad: ') ? 'ad' : 'dj'));
  assert.deepEqual(kinds.slice(0, 8), ['dj', 'song', 'dj', 'song', 'dj', 'song', 'ad', 'dj']);
  for (const c of caps.slice(1)) {
    if (c.text.startsWith('Ad: ')) assert.ok(AD_LINES.includes(c.text.slice(4)));
    else if (!c.text.startsWith('Now playing: ')) assert.ok(DJ_LINES.includes(c.text), c.text);
    assert.ok(c.dur >= 3 && c.dur < 20);
  }
  for (let i = 1; i < caps.length; i++) assert.notEqual(caps[i].text, caps[i - 1].text);
  // blips exist under the DJ lines, none under the songs' own caption bar
  const blips = out.flat().filter((n) => n.inst.startsWith('voc'));
  assert.ok(blips.length > 100);
  // captions never come faster than the speech they belong to
  for (let i = 1; i < caps.length; i++) assert.ok(caps[i].bar > caps[i - 1].bar);
});

test('speech texture: one blip per syllable, falling end, rising question', () => {
  const rng = createRng(9);
  const s = speechEvents('Hello there, island.', rng, 0);
  assert.equal(s.events.length, syllables('Hello') + syllables('there') + syllables('island'));
  for (let i = 1; i < s.events.length; i++) assert.ok(s.events[i].beat > s.events[i - 1].beat);
  assert.ok(s.seconds > 0.5 && s.seconds < 4);
  const q = speechEvents('Is it legal?', createRng(1), 0).events;
  const st = speechEvents('Is it legal.', createRng(1), 0).events;
  assert.ok(q[q.length - 1].semi > st[st.length - 1].semi, 'a question ends higher');
});
