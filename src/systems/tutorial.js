// The first five minutes (docs/LOOP.md section e), then the short
// first-time hints. The intro leads a new player through five beats with
// one short line each (9 words at most) and the GPS on the next gate: a
// near-miss run, a first medal, the police and an escape, a ramp, a garage.
// Every beat waits for what the player actually does, so it can be done in
// any order and at any pace; Pause, Skip intro ends it and Replay intro
// starts it again (`game.tutorial`). The step is kept in the save
// (progress.loop.intro). No text walls: one line at a time in the top
// stack, never while another of its lines is still up.
//
// After (or without) the intro: the old hints, each shown once, the first
// time the player is in that situation.
// One line each (docs/REVAMP.md 6.12): about 36 characters fit the narrowest hint row.
import { loopOf } from '../core/records.js';
import { nearestEvent } from '../world/eventspots.js';

const HINTS = {
  car: ['Hold GAS to drive.', 'Steer with the wheel on the left.', 'Tap EXIT to get out of the car.', 'Walk up to a car and tap ENTER.'],
  foot: ['Left stick to walk.', 'Drag the right side to look around.', 'Hold FIRE to shoot. LOCK sticks to a target.', 'SWAP changes weapon.', 'Boats wait at the piers.', 'Aircraft are at Gullwing Airfield.'],
  boat: ['Hold GAS. Boats turn best under power.', 'Pull up beside a pier to get out.'],
  plane: ['Hold THRUST, push the stick up.', 'Let go of the stick to level out.', 'Ease off THRUST to come down.'],
  heli: ['Hold UP to lift off.', 'Stick forward to fly, sideways to turn.', 'Let go of both pedals to hover.'],
  // Craft hints by spec id, offered on entering (docs/ARMS.md section 8).
  fighter: ['Gannetfang: full THRUST is afterburner.', 'LOCK on, then MSL.'],
  patrolheli: ['Lampwatch: SIREN and SPOT are under more.'],
  tank: ['Left stick drives. Push sideways to pivot.', 'Drag the right side to aim the turret.', 'Tap CANNON for a shell, hold COAX.', 'LOCK swings the turret onto a target.'], // task 32
};
const FIRST = ['Open the map (top right) for races.', 'Stop in a glowing marker, tap START.'];

// The intro's beats and lines (US English, 9 words at most each).
export const INTRO_STEPS = ['run', 'medal', 'police', 'ramp', 'garage'];
export const INTRO_LINES = {
  run: 'Hold GAS. Drive through the blue gate.',
  runOn: 'Pass close. Every pass counts.',
  medalMiss: 'No medal yet. Tap RETRY.',
  medal: 'First medal! Gates glow on the map.',
  police: 'Red gate next: it calls the police.',
  wanted: 'Police! Break their line of sight.',
  escaped: 'You lost them. That pays big.',
  ramp: 'Purple gate: hit the ramp fast.',
  air: 'Brake flips, steer rolls. Land flat.',
  garage: 'Last stop: a garage. Paint is free.',
  done: 'You are set. Three dailies wait in Pause.',
  bank: 'Stop anywhere to bank your flow.',
  tier: 'Flow x2: everything pays double.',
};
export const INTRO_REPEAT_S = 35; // a beat's line comes again after this long without progress
export const INTRO_GAP_S = 5; // seconds between two intro lines
export const GARAGE_NEAR = 40; // m from the garage that ends the last beat
export const GARAGE_ARRIVED = 90; // m: the GPS arriving at the garage this close ends it too (the route ends on the road)
export const CLEAR_NEAR = 70, CLEAR_FAR = 170; // m ahead: where the first run's lane is kept clear of moving traffic
export const QUEUE_NEAR = 40; // m ahead: from here on, traffic standing in the first run's lane is taken away
// Slow cars staged in the first run's lane, to pass (moving traffic is
// cleared, so without them only the parked cars would pay): m past the
// gate, put there as the player comes up to it from behind (at least
// traffic's own spawn distance, 90 m, ahead of the player on the drive up),
// and their speed.
export const STAGE_AT = [50, 90, 135];
export const STAGE_SPEED = 6; // m/s (13 mph): a car the run passes at 40 mph and more
export const STAGE_FROM = [-45, -4]; // m along the gate's way: where the player is when they are put there
const words = (s) => s.split(/\s+/).filter(Boolean).length;
export const INTRO_MAX_WORDS = Math.max(...Object.values(INTRO_LINES).map(words));

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

  // A real map words the place hints for itself (city.texts).
  const texts = (game.city && game.city.texts) || {};
  function offer(mode) {
    let list = HINTS[mode];
    // A real map words the craft hints for itself, one sentence per line.
    if (list && mode === 'foot' && texts.craft) list = list.slice(0, 4).concat(String(texts.craft).split(/(?<=[.!?])\s+/));
    if (!list || seen(mode)) return;
    // While the intro runs it says how to drive itself; the car hints wait for its end.
    if (introOn() && mode === 'car') return;
    mark(mode);
    for (const text of list) queue.push(text);
    if (!seen('first') && !introOn()) {
      mark('first');
      for (const text of FIRST) queue.push(text);
    }
  }

  // ---- the first five minutes ----
  const se = () => game.streetEvents || null;
  const intro = () => loopOf(game.progress).intro;
  const introOn = () => !!se() && se().list.length > 0 && !intro().done;
  let lineGap = 0, sinceLine = 99, said = '';
  let pending = ''; // a line waiting for its turn
  let saidBank = false, saidTier = false, saidWanted = false;
  let target = null; // what the GPS is on for this beat
  const GAR = { x: 0, z: 0, name: 'Garage' };
  const hudToast = (text) => { if (game.hud && game.hud.toast) game.hud.toast(text, 5, 'objective'); };
  function say(key) {
    pending = INTRO_LINES[key] || '';
  }
  function setStep(n) {
    const it = intro();
    it.step = n;
    if (n >= INTRO_STEPS.length) it.done = true;
    if (game.loopSave) game.loopSave(); else game.events.emit('progress');
    aim();
  }
  // Point the GPS at this beat's gate (or garage).
  function aim() {
    const s = se();
    if (!s) return;
    const p = game.player;
    const step = INTRO_STEPS[intro().step];
    target = null;
    beatLabel = '';
    if (!introOn()) { s.track(null); if (s.holdOthers) s.holdOthers(null); return; }
    if (step === 'run' || step === 'medal') target = nearestEvent(s.list, p.x, p.z, 'miss');
    else if (step === 'police') target = s.list.find((e) => e.tpl === 'heat' && e.level === 1) || nearestEvent(s.list, p.x, p.z, 'heat');
    else if (step === 'ramp') target = nearestEvent(s.list, p.x, p.z, 'jump');
    else if (step === 'garage') {
      let best = null, bd = Infinity;
      for (const g of (game.city && game.city.garages) || []) {
        // Only one the player can use now: a locked garage (Key Point Shed, out on a key
        // with no road) is no "last stop", its door stays shut.
        // (Locked ones count only as a last resort, a region with no open garage.)
        const at = g.door || g;
        const d = Math.hypot(at.x - p.x, at.z - p.z) + (garageUsable(g) ? 0 : 1e6);
        if (d < bd) { bd = d; best = at; }
      }
      if (best) { GAR.x = best.x; GAR.z = best.z; target = GAR; }
    }
    s.track(step === 'medal' ? null : target); // during the first run and its RETRY offer the GPS stays quiet
    if (s.holdOthers) s.holdOthers(target); // the other gates stay shut while a beat leads somewhere
  }
  function finish() {
    setStep(INTRO_STEPS.length);
    say('done');
  }
  const stepName = () => INTRO_STEPS[intro().step] || '';
  const garageUsable = (g) => (game.explore && game.explore.garageOpen ? game.explore.garageOpen(g.id) : !g.locked);

  game.events.on('streetEventStart', (ev) => {
    if (!introOn()) return;
    if (stepName() === 'run' && ev.tpl === 'miss') { setStep(1); say('runOn'); }
  });
  game.events.on('streetEventEnd', (r) => {
    if (r && r.tpl === 'miss') staged = false; // a RETRY of the first run gets its own
    if (!introOn()) return;
    const st = stepName();
    if ((st === 'run' || st === 'medal') && r.medal) { setStep(2); say('medal'); lineGap = 6; pendingNext = 'police'; } else if (st === 'medal' && !r.medal) say('medalMiss');
    else if (st === 'ramp' && r.tpl === 'jump' && r.result === 'done') { setStep(4); say('air'); pendingNext = 'garage'; }
  });
  game.events.on('policeEscaped', () => {
    if (!introOn()) return;
    if (stepName() === 'police') { setStep(3); say('escaped'); pendingNext = 'ramp'; }
  });
  game.events.on('stunt', (e) => {
    if (!introOn() || stepName() !== 'ramp' || !e || !e.ok) return;
    const v = game.player.vehicle;
    if (v && v.air && v.air.spot === e.spot && !v.air.on) { setStep(4); say('air'); pendingNext = 'garage'; }
  });
  game.events.on('garageFound', () => { if (introOn() && stepName() === 'garage') finish(); });
  // The GPS said "You have arrived" at the garage: the beat is done there, even
  // when the door stands farther than GARAGE_NEAR back from the road.
  game.events.on('gpsArrived', () => {
    const s = se();
    if (!introOn() || stepName() !== 'garage' || !target || !s || s.active || s.tracked !== target) return;
    if (Math.hypot(target.x - game.player.x, target.z - game.player.z) < GARAGE_ARRIVED) finish();
  });
  game.events.on('progressReset', () => { said = ''; pending = ''; pendingNext = ''; saidBank = saidTier = saidWanted = false; target = null; started = false; staged = false; });
  let pendingNext = ''; // the next beat's line, said after the line that closed the last beat
  let started = false;
  let beatLabel = ''; // the beat line the GPS goal carries
  let clearT = 0, wasFirstRun = false;
  let staged = false; // the first run's slow cars are out for this approach

  // The player in a car coming up to the first gate from behind: the slow
  // cars of the first run go into the lane past it.
  function stageFirstRun(s, p) {
    const v = p.vehicle;
    const tr = game.traffic;
    if (!v || v.kind !== 'car' || !tr || !tr.stageAhead) return;
    let ev = null;
    for (let i = 0; i < s.list.length && !ev; i++) if (s.list[i].intro) ev = s.list[i];
    if (!ev) return;
    const dx = p.x - ev.x, dz = p.z - ev.z;
    const al = dx * ev.dx + dz * ev.dz;
    if (al < STAGE_FROM[0] || al > STAGE_FROM[1] || Math.abs(-dx * ev.dz + dz * ev.dx) > ev.w + 4) return;
    staged = true;
    tr.stageAhead(ev.x, ev.z, ev.dx, ev.dz, STAGE_AT, STAGE_SPEED);
  }

  function stepIntro(dt) {
    const s = se();
    const p = game.player;
    if (!started) {
      started = true;
      // A fresh start: the queue at the first light makes room.
      if (intro().step === 0 && s.clearAhead) s.clearAhead(90);
      aim();
      say(stepName() === 'medal' ? 'run' : stepName());
    }
    sinceLine += dt;
    if (lineGap > 0) lineGap -= dt;
    const st = stepName();
    // The very first run is a clear street lined with parked cars: moving
    // traffic far ahead in the lane is taken away before the player gets to
    // it (and the queue at the gate once, as the run starts). After the first
    // medal the streets are as they are.
    if ((st === 'run' || st === 'medal') && s.clearAhead) {
      clearT -= dt;
      const firstRun = !!s.active && s.active.ev.intro === true;
      if (firstRun && !wasFirstRun) s.clearAhead(CLEAR_FAR, 2, true);
      wasFirstRun = firstRun;
      if (clearT <= 0 && (firstRun || st === 'run')) {
        clearT = 0.25;
        s.clearAhead(CLEAR_FAR, CLEAR_NEAR, true);
        // A queue stopped at a light nearer in (the start street's cars brake
        // for the first light) goes too, before the player can reach it.
        s.clearAhead(CLEAR_NEAR, QUEUE_NEAR, false);
      }
      if (!staged && !s.active) stageFirstRun(s, p);
    }
    // Before the police beat, a bump or a fast stretch does not call the
    // police: the first run is about passing close, and a star nobody has
    // explained yet only confuses it (the red gate brings them on purpose).
    // The police step comes first: the grace keeps a bump from raising a
    // star in that step, and the points it left are cleared here.
    const heat = game.police && game.police.heat;
    if ((st === 'run' || st === 'medal') && heat && heat.level === 0) { heat.points = 0; heat.speedTime = 0; heat.grace = Math.max(heat.grace, 0.5); }
    // Things the player ran into by themselves.
    const stars = game.police ? game.police.stars : 0;
    if (stars > 0 && !saidWanted && !pending && intro().step >= 1) { saidWanted = true; say('wanted'); }
    if (game.flow && !pending && !s.active) {
      if (!saidTier && game.flow.tier >= 2) { saidTier = true; say('tier'); }
      else if (!saidBank && game.flow.run >= 400 && stars === 0 && intro().step >= 2) { saidBank = true; say('bank'); }
    }
    if (st === 'garage' && target && Math.hypot(target.x - p.x, target.z - p.z) < GARAGE_NEAR) finish();
    // The GPS follows the beat (a retry or an event start clears the tracked gate).
    if (target && !s.active && s.tracked !== target && (st !== 'medal' || !(s.retryLeft > 0))) s.track(target, beatLabel);
    // One line at a time.
    if (!pending && pendingNext && lineGap <= 0 && sinceLine >= INTRO_GAP_S) { pending = INTRO_LINES[pendingNext] || ''; pendingNext = ''; }
    if (!pending && !pendingNext && sinceLine >= INTRO_REPEAT_S && !s.active && stars === 0) pending = INTRO_LINES[st === 'medal' ? 'run' : st] || '';
    if (pending && sinceLine >= (said ? INTRO_GAP_S : 0)) {
      const beat = pending === INTRO_LINES[st === 'medal' ? 'run' : st];
      said = pending;
      pending = '';
      sinceLine = 0;
      // A beat's own line rides on the GPS goal (the objective shows its
      // label once, in the same row); every other line is a line of its own.
      if (beat && target && s.tracked === target && !s.active) {
        if (beatLabel === said) hudToast(said);
        beatLabel = said;
        s.track(target, said);
      } else hudToast(said);
    }
  }

  game.events.on('mode', (mode) => {
    queue.length = 0; // stale hints for the previous craft or place
    offer(mode);
  });
  game.events.on('enter', (v) => {
    if (v && v.spec && (v.spec.id === 'fighter' || v.spec.id === 'patrolheli')) offer(v.spec.id);
  });

  const sys = {
    name: 'tutorial',
    get introOn() { return introOn(); },
    get introStep() { return introOn() ? stepName() : ''; },
    get lastLine() { return said; },
    // Pause, Skip intro: no more lines, the GPS lets go.
    skip() {
      if (!se()) return;
      intro().step = INTRO_STEPS.length;
      intro().done = true;
      pending = pendingNext = '';
      target = null;
      se().track(null);
      if (se().holdOthers) se().holdOthers(null);
      game.events.emit('progress');
    },
    // Pause, Replay intro: from the first beat, from wherever the player is.
    replay() {
      if (!se()) return;
      intro().step = 0;
      intro().done = false;
      said = pending = pendingNext = '';
      saidBank = saidTier = saidWanted = false;
      started = false;
      staged = false;
      sinceLine = 99;
      game.events.emit('progress');
    },
    fixedUpdate(dt) {
      // Nothing while the title screen still shows (the simulation runs behind it).
      if (game.titleCam && game.titleCam.active) return;
      if (introOn() && !game.phoneCheckRunning) {
        const mode = game.player.mode;
        if (mode === 'car' || mode === 'foot') stepIntro(dt);
      }
      if (wait === 2.5 && queue.length === 0) offer(game.player.mode);
      wait -= dt;
      if (wait > 0 || queue.length === 0) return;
      // Hold hints back while a race or a street event is running.
      if (game.activities && game.activities.active) return;
      if (se() && se().active) return;
      // Hints keep to their own queue while wanted or just after a police toast.
      if (game.hud.canHint && !game.hud.canHint()) return;
      game.hud.toast(queue.shift(), 4.5, 'hint');
      wait = 5.5;
    },
  };
  game.tutorial = sys;
  return sys;
}
