// Fixed-step game loop: the simulation always advances in equal slices
// (60 per second) regardless of how fast the screen draws.
import { createErrorLog, consoleLog } from './errorlog.js';

export const STEP = 1 / 60;

// `getScale` (optional) returns the game's time scale: real time is scaled
// before it is added to the accumulator, so each step is still STEP long.
// hold(frames): a kill freeze (REVAMP 6.7). For that many drawn frames the
// loop runs no simulation steps and adds no time; the world simply stops,
// then carries on from the same step (no wall clock reaches the logic).
export const HOLD_MAX = 4;
// errors (optional): a createErrorLog to report to. A step or a draw that
// throws is caught here, reported once per distinct message, and the loop
// keeps going: the step still counts (the clock never stalls or repeats),
// and the next frame is requested before any work, so one bad frame never
// stops the game.
export function createLoop({ fixedUpdate, render, maxSteps = 5, getScale = null, errors = null }) {
  const errs = errors || createErrorLog({ log: consoleLog });
  const safeStep = () => {
    try {
      fixedUpdate(STEP);
    } catch (e) {
      errs.report('step', e);
    }
  };
  const safeRender = (alpha, dt) => {
    try {
      render(alpha, dt);
    } catch (e) {
      errs.report('draw', e);
    }
  };
  let acc = 0;
  let held = 0;
  let last = 0;
  let running = false;
  let raf = 0;
  function frame(nowMs) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const now = nowMs / 1000;
    let dt = now - last;
    last = now;
    if (dt > 0.25) dt = 0.25;
    if (held > 0) {
      held--;
      safeRender(acc / STEP, dt);
      return;
    }
    let scale = getScale ? getScale() : 1;
    if (!(scale > 0)) scale = 1;
    acc += dt * scale;
    let steps = 0;
    while (acc >= STEP && steps < maxSteps) {
      safeStep();
      acc -= STEP;
      steps++;
    }
    if (steps === maxSteps) acc = 0;
    safeRender(acc / STEP, dt);
  }
  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now() / 1000;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    get running() {
      return running;
    },
    // Freeze the simulation for n drawn frames (never stacked past HOLD_MAX).
    hold(n) {
      const k = Math.max(0, Math.min(HOLD_MAX, n | 0));
      if (k > held) held = k;
      return held;
    },
    get held() {
      return held;
    },
    errors: errs,
  };
}
