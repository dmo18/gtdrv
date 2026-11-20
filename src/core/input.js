// One shared input state that every control method (keyboard, touch,
// gamepad) feeds. Game code only ever reads from here.
//
// Axes:    steer (-1 left .. 1 right), throttle (0..1), brake (0..1),
//          handbrake (bool), moveX (-1 left .. 1 right),
//          moveY (-1 back .. 1 forward), sprint (bool)
// Look:    lookX / lookY accumulate camera drag in pixels; the camera
//          reads them and sets them back to 0.
// Buttons: 'enter' (get in/out), 'attack', 'horn', 'camera', 'map',
//          'pause', 'weapon', 'jump'. Use pressed(name) for "was tapped
//          this step" and held(name) for "is down now".
export function createInput() {
  const sources = [];
  const heldSet = new Set();
  const pressedSet = new Set();
  const input = {
    steer: 0, throttle: 0, brake: 0, handbrake: false,
    moveX: 0, moveY: 0, sprint: false,
    lookX: 0, lookY: 0,
    // A source is a plain object with any of the axis fields above.
    addSource(src) {
      sources.push(src);
      return src;
    },
    press(name) {
      if (!heldSet.has(name)) pressedSet.add(name);
      heldSet.add(name);
    },
    release(name) {
      heldSet.delete(name);
    },
    held: (name) => heldSet.has(name),
    pressed: (name) => pressedSet.has(name),
    // Returns true once per tap, then forgets it.
    consume(name) {
      return pressedSet.delete(name);
    },
    // Call once per simulation step before reading axes.
    poll() {
      let steer = 0, throttle = 0, brake = 0, moveX = 0, moveY = 0;
      let handbrake = false, sprint = false;
      for (const s of sources) {
        if (Math.abs(s.steer || 0) > Math.abs(steer)) steer = s.steer;
        if ((s.throttle || 0) > throttle) throttle = s.throttle;
        if ((s.brake || 0) > brake) brake = s.brake;
        if (Math.abs(s.moveX || 0) > Math.abs(moveX)) moveX = s.moveX;
        if (Math.abs(s.moveY || 0) > Math.abs(moveY)) moveY = s.moveY;
        handbrake = handbrake || !!s.handbrake;
        sprint = sprint || !!s.sprint;
      }
      input.steer = steer;
      input.throttle = throttle;
      input.brake = brake;
      input.moveX = moveX;
      input.moveY = moveY;
      input.handbrake = handbrake;
      input.sprint = sprint;
    },
    // Call once per simulation step after everything has read input.
    endStep() {
      pressedSet.clear();
    },
  };
  return input;
}

// Keyboard controls, mainly for testing on a computer.
export function attachKeyboard(input, target = window) {
  const src = input.addSource({ steer: 0, throttle: 0, brake: 0, handbrake: false, moveX: 0, moveY: 0, sprint: false });
  const down = new Set();
  const buttons = { KeyF: 'enter', Enter: 'enter', KeyE: 'attack', KeyH: 'horn', KeyC: 'camera', KeyM: 'map', Escape: 'pause', KeyQ: 'weapon', KeyJ: 'jump' };
  const refresh = () => {
    const l = down.has('ArrowLeft') || down.has('KeyA');
    const r = down.has('ArrowRight') || down.has('KeyD');
    const u = down.has('ArrowUp') || down.has('KeyW');
    const d = down.has('ArrowDown') || down.has('KeyS');
    src.steer = (r ? 1 : 0) - (l ? 1 : 0);
    src.throttle = u ? 1 : 0;
    src.brake = d ? 1 : 0;
    src.moveX = src.steer;
    src.moveY = (u ? 1 : 0) - (d ? 1 : 0);
    src.handbrake = down.has('Space');
    src.sprint = down.has('ShiftLeft') || down.has('ShiftRight');
  };
  const onDown = (e) => {
    if (e.repeat) return;
    down.add(e.code);
    if (buttons[e.code]) input.press(buttons[e.code]);
    refresh();
  };
  const onUp = (e) => {
    down.delete(e.code);
    if (buttons[e.code]) input.release(buttons[e.code]);
    refresh();
  };
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
  };
}
