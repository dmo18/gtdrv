// Fixed-step game loop: the simulation always advances in equal slices
// (60 per second) regardless of how fast the screen draws.
export const STEP = 1 / 60;

// `getScale` (optional) returns the game's time scale: real time is scaled
// before it is added to the accumulator, so each step is still STEP long.
export function createLoop({ fixedUpdate, render, maxSteps = 5, getScale = null }) {
  let acc = 0;
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
    let scale = getScale ? getScale() : 1;
    if (!(scale > 0)) scale = 1;
    acc += dt * scale;
    let steps = 0;
    while (acc >= STEP && steps < maxSteps) {
      fixedUpdate(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === maxSteps) acc = 0;
    render(acc / STEP, dt);
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
  };
}
