import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQualityBench, pickQuality, neverChosen, LOW, NORMAL, HIGH, BENCH_MS } from '../src/core/qualitybench.js';
import { sanitizeProgress } from '../src/core/save.js';
import { createTitle, progressText } from '../src/ui/title.js';

function run(ms, perFrame) {
  const b = createQualityBench();
  let t = 0, i = 0;
  while (!b.push(typeof perFrame === 'function' ? perFrame(i++) : perFrame)) {
    t += 1;
    assert.ok(t < 5000, 'ends');
  }
  assert.ok(ms === undefined || t > 0);
  return b.result();
}

test('a phone holding 60 fps keeps full resolution (Normal)', () => {
  const r = run(undefined, 16.7);
  assert.equal(r.quality, NORMAL);
});
test('a phone far short of 60 fps drops to Low', () => {
  assert.equal(run(undefined, 40).quality, LOW);
});
test('a display well ahead of 60 fps is offered High', () => {
  assert.equal(run(undefined, 8.3).quality, HIGH);
});
test('single spikes and long stalls do not decide the verdict', () => {
  const r = run(undefined, (i) => (i % 40 === 0 ? 120 : i === 7 ? 900 : 16.7));
  assert.equal(r.quality, NORMAL);
});
test('too few frames give no verdict, the warm-up is not counted', () => {
  const b = createQualityBench();
  assert.equal(b.push(1000), false);
  assert.equal(b.push(1000), false);
  assert.equal(b.push(1000), true);
  assert.equal(b.result(), null);
  const w = createQualityBench();
  for (let i = 0; i < 20; i++) w.push(16.7); // 334 ms: all warm-up
  assert.equal(w.frames, 0);
  assert.ok(BENCH_MS === 3000);
});
test('pickQuality on missing numbers stays Normal', () => {
  assert.equal(pickQuality(NaN, 10), NORMAL);
  assert.equal(pickQuality(0, 0), NORMAL);
});

test('only a player who never chose one is measured', () => {
  assert.equal(neverChosen({ quality: 1 }), true);
  assert.equal(neverChosen({ quality: 1, qualityChosen: true }), false);
  assert.equal(neverChosen({ quality: 1, qualityBenchmarked: true }), false);
  assert.equal(neverChosen({ quality: 0.75 }), false);
  assert.equal(neverChosen({ quality: 1.25 }), false);
  assert.equal(neverChosen(null), false);
});

test('a benchmark that left Normal is measured again; a player choice never', () => {
  assert.equal(neverChosen({ quality: 0.75, qualityBenchmarked: true }), true);
  assert.equal(neverChosen({ quality: 1.25, qualityBenchmarked: true }), true);
  assert.equal(neverChosen({ quality: 0.75, qualityBenchmarked: true, qualityChosen: true }), false);
  assert.equal(neverChosen({ quality: 1.25, qualityChosen: true }), false);
});

test('the stored flags are validated by the save sanitiser', () => {
  const ok = sanitizeProgress({ settings: { quality: 0.75, qualityBenchmarked: true, qualityChosen: true } });
  assert.equal(ok.settings.quality, 0.75);
  assert.equal(ok.settings.qualityBenchmarked, true);
  assert.equal(ok.settings.qualityChosen, true);
  const bad = sanitizeProgress({ settings: { quality: 3, qualityBenchmarked: 'yes', qualityChosen: 1 } });
  assert.equal(bad.settings.quality, 1);
  assert.equal(bad.settings.qualityBenchmarked, undefined);
  assert.equal(bad.settings.qualityChosen, undefined);
});

test('the title writes progress as text only and clamps it', () => {
  const els = {};
  const mk = () => ({ textContent: '', style: {}, hidden: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} });
  for (const id of ['boot', 'play', 'continue', 'bootmsg', 'bootbar', 'bootbarfill']) els[id] = mk();
  const title = createTitle({ getElementById: (id) => els[id] || null });
  title.setProgress('Building streets', 40);
  assert.equal(els.bootmsg.textContent, 'Building streets 40 percent');
  assert.equal(els.bootbarfill.style.width, '40%');
  assert.equal(els.bootbar.attrs['aria-valuenow'], '40');
  title.setProgress('<b>x</b>', 250);
  assert.equal(els.bootmsg.textContent, '<b>x</b> 100 percent');
  assert.equal(progressText('', -5), 'Loading 0 percent');
  title.endProgress();
  assert.equal(els.bootbar.hidden, true);
});
