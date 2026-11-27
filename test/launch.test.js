import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { continueAfter, failureKind, failureMessage, createRotationGate } from '../src/core/launch.js';
import { createQualityBench, LOW, NORMAL } from '../src/core/qualitybench.js';

// --- Continue never waits on the browser ---
function fakeTimer() {
  const q = [];
  return { later: (fn) => q.push(fn), fire: () => q.splice(0).forEach((f) => f()) };
}
const tick = () => new Promise((r) => setImmediate(r));

test('continue restores once when the step resolves', async () => {
  const t = fakeTimer();
  let n = 0;
  continueAfter(() => Promise.resolve(), () => n++, t.later);
  await tick();
  t.fire();
  assert.equal(n, 1);
});
test('continue restores once when the step rejects, throws or is absent', async () => {
  for (const step of [() => Promise.reject(new Error('no')), () => { throw new Error('x'); }, undefined, () => 5]) {
    const t = fakeTimer();
    let n = 0;
    continueAfter(step, () => n++, t.later);
    await tick();
    t.fire();
    assert.equal(n, 1);
  }
});
test('continue restores once when the step never settles', async () => {
  const t = fakeTimer();
  let n = 0;
  continueAfter(() => new Promise(() => {}), () => n++, t.later);
  await tick();
  assert.equal(n, 0);
  t.fire();
  t.fire();
  assert.equal(n, 1);
});
test('a step settling after the bound does not restore twice', async () => {
  const t = fakeTimer();
  let n = 0, res;
  continueAfter(() => new Promise((r) => { res = r; }), () => n++, t.later);
  t.fire();
  res();
  await tick();
  assert.equal(n, 1);
});

// --- Quality benchmark with slow devices ---
function runMs(frame) {
  const b = createQualityBench();
  let i = 0;
  while (!b.push(typeof frame === 'function' ? frame(i++) : frame)) { /* until done */ }
  return b.result();
}
test('slow frame rates pick Low even with fewer than 60 samples', () => {
  for (const ms of [33.3, 40, 50, 66.7, 100]) {
    const r = runMs(ms);
    assert.ok(r, `${ms} ms gives a verdict`);
    assert.equal(r.quality, LOW, `${ms} ms`);
  }
  assert.ok(runMs(100).frames < 60);
});
test('16.7 ms stays Normal; bursty single stalls never force Low', () => {
  assert.equal(runMs(16.7).quality, NORMAL);
  assert.equal(runMs((i) => (i % 40 === 0 ? 240 : 16.7)).quality, NORMAL);
  const s = runMs((i) => (i % 5 === 0 ? 900 : 16.7));
  assert.ok(s === null || s.quality !== LOW);
});
test('a few fast frames among long stalls give no verdict', () => {
  const r = runMs((i) => (i % 2 ? 16.7 : 600));
  assert.equal(r, null);
});
test('a mostly fast run with fewer than 60 frames is not forced Low', () => {
  // 30 frames of 16.7 then stalls to the end: counted frames are fast and few.
  let k = 0;
  const r = runMs(() => (k++ < 60 ? 16.7 : 800));
  assert.ok(r === null || r.quality !== LOW);
});
test('a hidden page (huge frames) gives no verdict', () => {
  assert.equal(runMs(1500), null);
});

// --- Rotation gate ---
function rig() {
  const game = { paused: false };
  const log = [];
  let cleared = 0;
  const gate = createRotationGate();
  const call = (portrait) => gate.update(portrait, game, (p) => log.push(p), () => cleared++);
  return { game, log, call, cleared: () => cleared };
}
test('portrait pauses and clears held input, landscape resumes', () => {
  const r = rig();
  assert.equal(r.call(true), 'paused');
  assert.equal(r.game.paused, true);
  assert.equal(r.cleared(), 1);
  assert.equal(r.call(false), 'resumed');
  assert.equal(r.game.paused, false);
  assert.deepEqual(r.log, [true, false]);
});
test('a manual pause stays paused after rotating back', () => {
  const r = rig();
  r.game.paused = true;
  assert.equal(r.call(true), '');
  assert.equal(r.cleared(), 1);
  assert.equal(r.call(false), '');
  assert.equal(r.game.paused, true);
  assert.deepEqual(r.log, []);
});
test('repeated portrait events clear input each time but pause once', () => {
  const r = rig();
  r.call(true);
  r.call(true);
  assert.equal(r.cleared(), 2);
  assert.deepEqual(r.log, [true]);
  r.call(false);
  r.call(false);
  assert.deepEqual(r.log, [true, false]);
});
test('a resume made elsewhere while covered is not paused again', () => {
  const r = rig();
  r.call(true);
  r.game.paused = false;
  assert.equal(r.call(false), '');
  assert.equal(r.game.paused, false);
});

// --- Launch failure ---
test('failure guidance matches the cause', () => {
  assert.equal(failureKind(new Error('Error creating WebGL context')), 'graphics');
  assert.equal(failureKind({ name: 'TypeError', message: 'Failed to fetch dynamically imported module' }), 'download');
  assert.equal(failureKind(new Error('boom')), 'other');
  assert.equal(failureKind(null), 'other');
  assert.match(failureMessage('graphics'), /closing other tabs/);
  assert.match(failureMessage('download'), /connection/);
  assert.ok(failureMessage('other').length > 10);
});
test('the HTML shell carries the same messages, a retry button and a matching CSP hash', () => {
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  for (const k of ['graphics', 'download', 'other']) assert.ok(html.includes(failureMessage(k)), k);
  assert.match(html, /id="bootretry"/);
  assert.ok(!/innerHTML/.test(html));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`'sha256-${hash}'`), 'CSP allows exactly the inline shell script');
  assert.match(script, /25000/);
  assert.ok(!/[–—]/.test(html));
});
