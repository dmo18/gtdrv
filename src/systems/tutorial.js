// Short first-time hints. Each one is shown once, the first time the
// player is in that situation, and remembered in the saved progress.
const HINTS = {
  car: ['Hold GAS to drive. Steer with the wheel on the left.', 'Tap EXIT to get out. Walk up to anything and tap ENTER.'],
  foot: ['Left stick to walk, drag the right side to look around.', 'Hold FIRE to aim and shoot, drag to aim. LOCK sticks to a target, SWAP changes weapon.', 'Boats wait at the piers. Aircraft are at Gullwing Airfield, east over the causeway.'],
  boat: ['Hold GAS. Boats turn best under power.', 'Pull up beside a pier to get out.'],
  plane: ['Hold THRUST and push the stick up to take off.', 'Let go of the stick to level out. Ease off THRUST to come down.'],
  heli: ['Hold UP to lift off. Stick forward to fly, sideways to turn.', 'Let go of both pedals to hover.'],  // Craft hints by spec id, offered on entering (docs/ARMS.md section 8).
  fighter: ['Gannetfang: full THRUST is afterburner. LOCK on, then MSL.'],
  patrolheli: ['Lampwatch: SIREN and SPOT are under the more button.'],
  tank: ['Left stick drives; push it sideways to pivot. Drag the right side to aim the turret.', 'Tap CANNON for a shell, hold COAX for the gun. LOCK swings the turret onto a target.'], // task 32
};
const FIRST = ['Open the map (top right) to find races, piers and the airfield.', 'Stop inside a glowing marker, then tap START to begin a race or delivery.'];

export function createTutorial(game) {
  const queue = [];
  let wait = 2.5;
  // Remembered in the medals map because the save sanitiser only keeps
  // known fields. NOTE for the menu: Records must skip `hint_` and `seen_`
  // keys, they are flags, not medals.
  const seen = (key) => game.progress.medals[`hint_${key}`] === 'bronze';
  const mark = (key) => {
    game.progress.medals[`hint_${key}`] = 'bronze';
    game.events.emit('progress');
  };

  function offer(mode) {
    const list = HINTS[mode];
    if (!list || seen(mode)) return;
    mark(mode);
    for (const text of list) queue.push(text);
    if (!seen('first')) {
      mark('first');
      for (const text of FIRST) queue.push(text);
    }
  }

  game.events.on('mode', (mode) => {
    queue.length = 0; // stale hints for the previous craft or place
    offer(mode);
  });
  game.events.on('enter', (v) => {
    if (v && v.spec && (v.spec.id === 'fighter' || v.spec.id === 'patrolheli')) offer(v.spec.id);
  });

  return {
    name: 'tutorial',
    fixedUpdate(dt) {
      if (wait === 2.5 && queue.length === 0) offer(game.player.mode);
      wait -= dt;
      if (wait > 0 || queue.length === 0) return;
      // Hold hints back while a race is running.
      if (game.activities && game.activities.active) return;
      game.hud.toast(queue.shift(), 4.5);
      wait = 5.5;
    },
  };
}
