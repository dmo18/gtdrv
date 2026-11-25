// 0.13.5 audio mix: offline checks on the generated bank (node, JS path) for
// seams, edges, dropouts, DC and loudness balance between the sound groups.
// Companion to audio-harsh.test.js (peak, clipping, 2 to 5 kHz band, centroid).
// Numbers are proxies; nobody has listened (docs/AUDIO.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAll } from '../scripts/audio-analyze.mjs';
import { measure } from '../src/audio/analyze.js';

export const MIX = {
  seamStep: 1.0, // loop seam step at most the largest step inside the loop
  loopDc: 0.05, // |mean| / RMS of a loop
  shotDc: 0.1, // same for a one-shot
  startPeak: 0.02, // first sample vs peak (no click on start)
  endPeak: 0.01, // last sample vs peak (no click on stop)
  onsetMs: 30, // first sample over 10 % of peak (no silent lead-in)
  maxShotS: 5, // no one-shot longer (a sound that never stops)
  dropout: 0.3, // quietest 50 ms of a steady loop vs its RMS
  rpmStepDb: 6, // loudness step between neighbouring engine rpm points
  charSpreadDb: 6, // loudness spread between engine characters at full rpm
  idleSpreadDb: 7.5, // same at idle (props idle louder than outboards)
  loopRmsDb: -8, // RMS cap of any loop (sirens have their own)
  sirenRmsDb: -6,
  uiLoud: -9.5, // loudness caps per group
  weaponLoud: -10.5,
  ambienceLoud: -12,
};
// Loops that are silent between calls on purpose.
const GAPPY = new Set(['birds', 'crickets', 'lap']);
// Sounds that must speak at once (slow swells like whoosh, whistle, whiz are not).
const PUNCHY = /^(beep|click|pin|chime|checkpoint|hitTick|tink|lock|spotClick|killCue|fail|gun|reload|emptyClick|impact|crunch|glass|thud|thwack|bodyHit|slap|clank|pop|casing|ricochet|tank(Coax|Boom|Crush))/;
const bank = buildAll(48000);
const names = Object.keys(bank.buffers);
const data = (n) => bank.buffers[n].getChannelData(0);
const isLoop = (n) => bank.loops.includes(n);

function stats(d) {
  let pk = 0, sum = 0, ss = 0, step = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > pk) pk = a;
    sum += d[i];
    ss += d[i] * d[i];
    if (i) step = Math.max(step, Math.abs(d[i] - d[i - 1]));
  }
  return { pk, rms: Math.sqrt(ss / d.length), dc: sum / d.length, step };
}

test('loops: no click at the loop point, no DC, no dropouts, bounded level', () => {
  const loops = names.filter(isLoop);
  assert.ok(loops.length > 40);
  assert.ok(loops.includes('fireCrackle'), 'fireCrackle is played as a loop');
  for (const n of loops) {
    const d = data(n), sr = bank.buffers[n].sampleRate, s = stats(d);
    const seam = Math.abs(d[0] - d[d.length - 1]);
    assert.ok(seam <= MIX.seamStep * s.step, `${n}: seam step ${seam.toFixed(4)} over the largest inner step ${s.step.toFixed(4)}`);
    assert.ok(Math.abs(s.dc) / s.rms <= MIX.loopDc, `${n}: DC ${(s.dc / s.rms).toFixed(3)}`);
    const rmsDb = 20 * Math.log10(s.rms);
    const cap = /^siren/.test(n) ? MIX.sirenRmsDb : MIX.loopRmsDb;
    assert.ok(rmsDb <= cap, `${n}: RMS ${rmsDb.toFixed(1)} dBFS over ${cap}`);
    if (GAPPY.has(n)) continue;
    const W = Math.round(0.05 * sr);
    for (let a = 0; a + W <= d.length; a += W) {
      let r = 0;
      for (let i = 0; i < W; i++) r += d[a + i] * d[a + i];
      assert.ok(Math.sqrt(r / W) >= MIX.dropout * s.rms, `${n}: silence gap at ${(a / sr).toFixed(2)} s`);
    }
  }
});

test('one-shots: soft edges, no silent lead-in on cues, hits and shots, no endless sound', () => {
  for (const n of names.filter((x) => !isLoop(x) && x !== 'ir')) {
    const d = data(n), sr = bank.buffers[n].sampleRate, s = stats(d);
    assert.ok(Math.abs(d[0]) <= MIX.startPeak * s.pk, `${n}: starts at ${(Math.abs(d[0]) / s.pk).toFixed(3)} of peak`);
    assert.ok(Math.abs(d[d.length - 1]) <= MIX.endPeak * s.pk, `${n}: ends at ${(Math.abs(d[d.length - 1]) / s.pk).toFixed(3)} of peak`);
    assert.ok(Math.abs(s.dc) / s.rms <= MIX.shotDc, `${n}: DC ${(s.dc / s.rms).toFixed(3)}`);
    assert.ok(d.length / sr <= MIX.maxShotS, `${n}: ${(d.length / sr).toFixed(1)} s long`);
    if (!PUNCHY.test(n)) continue;
    let on = 0;
    while (on < d.length && Math.abs(d[on]) < 0.1 * s.pk) on++;
    assert.ok((on / sr) * 1000 <= MIX.onsetMs, `${n}: first sound after ${((on / sr) * 1000).toFixed(0)} ms`);
  }
});

const CHARS = { car: ['diesel', 'i4', 'v6', 'v8', 'sports'], boat: ['inboard', 'outboard'], air: ['prop'] };

test('engines per craft: rpm ladder rises evenly, throttle off is quieter, characters balance', () => {
  const lufs = (n) => measure(data(n), bank.buffers[n].sampleRate, true).lufs;
  const points = [];
  for (const [craft, list] of Object.entries(CHARS)) {
    for (const ch of list) {
      const on = [], off = [];
      for (let i = 0; bank.buffers[`eng:${ch}:${i}:on`]; i++) {
        on.push(lufs(`eng:${ch}:${i}:on`));
        off.push(lufs(`eng:${ch}:${i}:off`));
      }
      assert.ok(on.length >= 5, `${craft} ${ch}: rpm points`);
      for (let i = 0; i < on.length; i++) {
        assert.ok(off[i] < on[i], `${ch}:${i}: lift-off not quieter`);
        if (i) {
          assert.ok(on[i] - on[i - 1] <= MIX.rpmStepDb, `${ch}: step ${i} is ${(on[i] - on[i - 1]).toFixed(1)} dB`);
          assert.ok(on[i] >= on[i - 1] - 1, `${ch}: gets quieter at point ${i}`);
        }
      }
      points.push(on);
    }
  }
  for (const [k, lim] of [[0, MIX.idleSpreadDb], [4, MIX.charSpreadDb]]) {
    const v = points.map((p) => p[k]);
    assert.ok(Math.max(...v) - Math.min(...v) <= lim, `rpm point ${k} spread ${v.map((x) => x.toFixed(1))}`);
  }
});

test('group balance: UI, weapons and ambience stay under their caps and under the engines at full load', () => {
  const loud = (n) => measure(data(n), bank.buffers[n].sampleRate, isLoop(n)).lufs;
  const group = (re, cap, label) => {
    let seen = 0;
    for (const n of names) {
      if (!re.test(n)) continue;
      seen++;
      const l = loud(n);
      assert.ok(l <= cap, `${label} ${n}: ${l.toFixed(1)}`);
    }
    assert.ok(seen >= 3, `${label} has sounds`);
  };
  group(/^(beep|click|pin|chime|checkpoint|hitTick|tink|lock|spotClick|killCue|fail)/, MIX.uiLoud, 'ui');
  group(/^(gun|blast|tank|rocket|whistle|reload|ricochet|whiz)/, MIX.weaponLoud, 'weapon');
  group(/^(city|wind|rain|surf|lap|birds|crickets|wash)$/, MIX.ambienceLoud, 'ambience');
  const engTop = Math.max(...Object.values(CHARS).flat().map((ch) => loud(`eng:${ch}:4:on`)));
  assert.ok(engTop > MIX.ambienceLoud, 'engines at full load sit above the ambience cap');
});
