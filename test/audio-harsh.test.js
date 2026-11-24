// Task 14 (docs/PLAN_V4.md), 0.12.6: sound harshness by numbers. Owner:
// "harsh and crackly". Every generated buffer is measured offline (node, JS
// path); no class may clip, run hot, carry a loud 2 to 5 kHz band, or sit
// above its class's spectral centroid. Nobody has listened to these: the
// numbers are proxies (docs/AUDIO.md), the phone check is the judge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAll } from '../scripts/audio-analyze.mjs';
import { measure, spectrum, bandShares } from '../src/audio/analyze.js';

export const LIMITS = {
  peakDb: -0.9, // no buffer above this (the master limiter sits at -4 dBFS)
  hot: 0, // samples over 0.95 (clipping count)
  harshDb: -19.5, // RMS (dBFS) of the 2 to 5 kHz band alone
};
// Spectral centroid ceilings (Hz) per sound class, by name.
export const CLASSES = [
  ['engine', /^eng:/, 1000],
  ['siren', /^siren|^horn/, 1500],
  ['tires', /^(squeal|scrape|gravel|wet|road)$/, 4200],
  ['weapons', /^(gun|blast|tank|rocket|whistle|reload|emptyClick|ricochet|whiz)/, 3800],
  ['impacts', /^(impact|crunch|glass|debris|thud|thwack|bodyHit|slap|doorClose|doorOpen|clank|pop|casing)/, 6000],
  ['ui', /^(beep|click|pin|chime|checkpoint|hitTick|tink|lock|spotClick|killCue|fail)/, 3500],
];

test('sound harshness: no buffer clips or runs hot, no loud 2 to 5 kHz band, class centroids under their ceilings', () => {
  const bank = buildAll(48000);
  const seen = new Map();
  for (const n of Object.keys(bank.buffers)) {
    const b = bank.buffers[n], d = b.getChannelData(0), sr = b.sampleRate;
    const m = measure(d, sr, bank.loops.includes(n));
    assert.equal(m.clipped, 0, `${n} clips`);
    assert.ok(m.peakDb <= LIMITS.peakDb, `${n} peak ${m.peakDb.toFixed(2)} dBFS`);
    let hot = 0;
    for (let i = 0; i < d.length; i++) if (d[i] > 0.95 || d[i] < -0.95) hot++;
    assert.ok(hot <= LIMITS.hot, `${n}: ${hot} samples over 0.95`);
    const share = bandShares(spectrum(d, sr), [0, 2000, 5000, 1e9])[1];
    const harsh = m.rmsDb + 10 * Math.log10(share + 1e-9);
    assert.ok(harsh <= LIMITS.harshDb, `${n}: 2 to 5 kHz band at ${harsh.toFixed(1)} dBFS RMS`);
    for (const [cls, re, ceil] of CLASSES) {
      if (!re.test(n)) continue;
      seen.set(cls, (seen.get(cls) || 0) + 1);
      assert.ok(m.centroid <= ceil, `${cls} ${n}: centroid ${m.centroid.toFixed(0)} Hz over ${ceil}`);
    }
  }
  for (const [cls] of CLASSES) assert.ok(seen.get(cls) >= 2, `${cls} class has sounds`);
});
