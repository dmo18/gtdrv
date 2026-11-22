import test from 'node:test';
import assert from 'node:assert/strict';
import { createErrorLog } from '../src/core/errorlog.js';
import { createLoop, STEP } from '../src/core/loop.js';

test('error log: each distinct (place, message) is logged once, repeats are counted', () => {
  const logged = [];
  const log = createErrorLog({ max: 2, log: (where, e) => logged.push(where + ': ' + e.message) });
  assert.equal(log.report('draw', new TypeError('a')), true);
  assert.equal(log.report('draw', new TypeError('a')), false);
  assert.equal(log.report('step', new TypeError('a')), true, 'another place is another entry');
  // Past `max` distinct entries, new messages are only counted: memory and the console stay bounded.
  assert.equal(log.report('draw', new Error('b')), false);
  assert.equal(log.report('x', 'plain string'), false);
  assert.deepEqual(logged, ['draw: a', 'step: a']);
  assert.equal(log.count, 5);
  assert.equal(log.list.length, 2, 'only the first `max` kept');
  assert.equal(log.list[0].n, 2);
});

test('error log: a message that changes every frame cannot grow memory without limit', () => {
  const log = createErrorLog({ max: 4, log: () => {} });
  for (let i = 0; i < 1000; i++) log.report('draw', new Error('x=' + i));
  assert.equal(log.count, 1000);
  assert.equal(log.list.length, 4);
  assert.ok(log.report('draw', new Error('y'.repeat(5000))) === false, 'long messages are cut and still bounded');
});

// Drives the loop with a fake animation frame clock, 60 frames a second.
function drive(loop, frames) {
  let cb = null;
  globalThis.requestAnimationFrame = (f) => { cb = f; return 1; };
  globalThis.cancelAnimationFrame = () => { cb = null; };
  globalThis.performance = globalThis.performance || { now: () => 0 };
  loop.start();
  let nowMs = performance.now();
  let calls = 0;
  for (let i = 0; i < frames && cb; i++) {
    nowMs += 1000 / 60;
    const f = cb;
    cb = null;
    f(nowMs);
    calls++;
  }
  loop.stop();
  return calls;
}

test('a step or a draw that throws never stops the loop, and the clock stays the same', () => {
  const run = (bad) => {
    let steps = 0, draws = 0, simT = 0;
    const errors = createErrorLog();
    const loop = createLoop({
      fixedUpdate: (dt) => {
        steps++;
        simT += dt;
        if (bad && steps % 7 === 0) throw new TypeError("Cannot read properties of null (reading 'userData')");
      },
      render: () => {
        draws++;
        if (bad && draws > 3) throw new TypeError("Cannot read properties of undefined (reading 'visible')");
      },
      errors,
    });
    const frames = drive(loop, 240);
    return { frames, steps, draws, simT, errors };
  };
  const good = run(false), bad = run(true);
  assert.equal(bad.frames, 240, 'every frame asked for the next one');
  assert.equal(bad.draws, good.draws, 'drawing went on');
  assert.equal(bad.steps, good.steps, 'the same steps: a throwing step still counts');
  assert.ok(Math.abs(bad.simT - good.simT) < 1e-9 && Math.abs(good.simT - good.steps * STEP) < 1e-9);
  assert.equal(bad.errors.list.length, 2, 'two distinct errors');
  assert.ok(bad.errors.count > 200, 'every repeat counted');
  assert.equal(good.errors.count, 0);
});
