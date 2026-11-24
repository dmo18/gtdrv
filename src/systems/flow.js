// Flow in the game (docs/LOOP.md section a): feeds the flow core
// (core/flow.js) from play, banks runs into the score, keeps the records,
// and makes every source FELT: a short callout in the top stack, a sound
// that already exists (the UI click, checkpoint ping, chime and fail of
// systems/audio.js, by their events), a camera kick (game.chase.kick) and a
// freeze of a few frames (game.hitStop, the loop's hold) on the big ones.
//
// Sources that come from here: clean passes, smashed props, rams. The
// stunts (air time, drifts, near misses), takedowns and escapes come
// through systems/score.js `add`, which hands them over when game.flow
// exists. The logic runs in node tests (no DOM, no three.js needed).
import { createFlow, CRASH_MPS, TIER_MAX } from '../core/flow.js';
import { loopOf, recordBank, addTotal, noteBest, noteVehicle, addDistance } from '../core/records.js';
import { regionSlug } from '../world/eventspots.js';

export const PASS_SPEED = 12; // m/s: slower than this passes nobody
export const PASS_FASTER = 3; // m/s faster than the passed car
export const PASS_SIDE = 4.2; // m to the side, center to center, at most
export const PASS_AHEAD = 14; // m ahead: a car this close in front is being passed
export const PASS_COOL = 6; // seconds before the same car counts again
export const PASS_POINTS = 60;
export const SMASH_POINTS = 25, SMASH_CHAIN_S = 3, SMASH_CHAIN_BONUS = 5; // each prop; +5 per link of the chain
export const RAM_POINTS = 80, RAM_MPS = 5; // ramming a moving car (not a hard crash for the flow)
export const CRAWL_MPS = 4; // m/s: slower than this the player neither rams nor crashes (they are the one hit)
export const HARD_STOP = 0.55; // a hard crash also needs this share of the speed lost

// What each source says, which sound event it fires and how hard it kicks
// the camera (the strength chase.kick takes, a closing speed in m/s).
const JUICE = {
  nearMiss: { word: 'Near miss', sound: 'checkpoint', kick: 5.5, hold: 0 },
  oncoming: { word: 'Head-on miss', sound: 'checkpoint', kick: 8, hold: 2 },
  shave: { word: 'Close shave', sound: 'ui', kick: 4.5, hold: 0 },
  overtake: { word: 'Clean pass', sound: 'ui', kick: 3.5, hold: 0 },
  drift: { word: 'Drift', sound: 'ui', kick: 4, hold: 0 },
  air: { word: 'Air', sound: 'checkpoint', kick: 7, hold: 0 },
  jump: { word: 'Jump', sound: '', kick: 0, hold: 0 },
  speed: { word: '', sound: '', kick: 0, hold: 0 },
  takedown: { word: 'Wrecked', sound: '', kick: 6, hold: 0 }, // the blast and its freeze are combat's
  chain: { word: 'Chain blast', sound: 'checkpoint', kick: 8, hold: 0 },
  smash: { word: 'Smash', sound: '', kick: 4, hold: 0 }, // the prop makes its own noise
  escape: { word: 'Escaped', sound: 'reward', kick: 0, hold: 3 },
  stunt: { word: 'Stunt', sound: 'checkpoint', kick: 6, hold: 0 },
  event: { word: 'Event', sound: '', kick: 0, hold: 0 },
  other: { word: 'Bonus', sound: 'ui', kick: 0, hold: 0 },
};
const num = (n) => Math.round(n).toLocaleString('en-US');

export function createFlowSystem(game) {
  const events = game.events;
  const slug = regionSlug(game.city);
  const loop = () => loopOf(game.progress);
  let label = ''; // the words of the feed being made (set by feed())
  let quiet = false; // a feed that makes no callout of its own
  let nmChain = 0, smashChain = 0, smashT = 0, speedSaid = 0;
  let now = 0;
  let lastVeh = null;
  let eventOn = false; // a street event is running: the bank waits for its end
  let lx = NaN, lz = NaN;

  const hud = () => game.hud || null;
  const calm = () => !!(game.progress && game.progress.settings && game.progress.settings.reduceMotion);
  function sound(name) {
    if (!name || !events) return;
    if (name === 'reward') events.emit('reward', 0, 'flow');
    else if (name === 'fail') events.emit('fail', 'flow', 'crash');
    else events.emit(name, 'flow');
  }
  function callout(text, seconds = 1.3) {
    const h = hud();
    if (h && h.toast) h.toast(text, seconds, 'score');
  }
  function kick(strength, hold) {
    if (calm()) return;
    if (strength > 0 && game.chase && game.chase.kick) game.chase.kick(strength);
    if (hold > 0 && game.hitStop) game.hitStop(hold);
  }

  function onFlow(kind, a, b, c) {
    const h = hud();
    if (kind === 'feed') {
      const j = JUICE[a] || JUICE.other;
      if (a === 'speed') {
        // one callout per burst of speed, not one per tick
        if (now - speedSaid > 8) { speedSaid = now; callout('70 mph+  flow holds', 1.2); }
        return;
      }
      if (!quiet) {
        callout((label || j.word) + '  +' + num(b) + (flow.tier > 1 ? '  x' + flow.tier : ''));
        sound(j.sound);
        kick(j.kick, j.hold);
      }
      if (h && h.flowPop) h.flowPop('feed', flow.tier);
    } else if (kind === 'tier') {
      if (!b) { sound('ui'); return; } // a tier lost: a click, the bar steps down
      noteBest(loop(), 'tier', a);
      callout(a >= TIER_MAX ? 'FLOW x' + a + '  MAX' : 'FLOW x' + a, 1.5);
      sound('reward');
      kick(8, 2);
      if (h && h.flowPop) h.flowPop('tier', a);
    } else if (kind === 'bank') {
      const best = recordBank(loop(), slug, a);
      // Standing still: saved at once. At speed (an event's end, a flow gone cold): at the next quiet moment.
      if (game.score && game.score.bankFlow) game.score.bankFlow(a, b !== 'stop');
      if (b !== 'stop' && game.loopSave) game.loopSave();
      const how = b === 'stop' && c > 1 ? '  (x' + c + ' bonus)' : '';
      callout(best && a >= 1000 ? 'Best flow run!  ' + num(a) : 'Banked  ' + num(a) + how, 2.2);
      sound('reward');
      if (b !== 'cool') kick(0, 3);
      if (h && h.flowPop) h.flowPop('bank', 1);
      nmChain = 0;
      if (events) events.emit('flowBanked', a, b, best);
    } else if (kind === 'crash') {
      addTotal(loop(), 'crashes', 1);
      callout(a > 0 ? 'Crash  -' + num(a) : 'Crash  flow lost', 1.4);
      sound('fail');
      if (h && h.flowPop) h.flowPop('crash', 1);
      nmChain = 0;
    } else if (kind === 'wipe') {
      if (a > 0) callout('Run lost  -' + num(a), 1.6);
      sound('fail');
      if (h && h.flowPop) h.flowPop('crash', 1);
      nmChain = 0;
    }
  }
  const flow = createFlow(onFlow);

  // A source from play. `text` replaces the word of the callout; `seconds`
  // is the length of a drift or flight. Returns the points added.
  function feed(kind, points, text = '', seconds = 0, silent = false) {
    // The Phone check drives the car itself: nothing it does is the player's flow.
    if (game.phoneCheckRunning) return 0;
    label = text;
    quiet = silent;
    const got = flow.feed(kind, points, seconds);
    label = '';
    quiet = false;
    if (got > 0) {
      const L = loop();
      if (kind === 'nearMiss' || kind === 'oncoming' || kind === 'shave') { nmChain++; addTotal(L, 'nearMiss', 1); sys.passes++; }
      else if (kind === 'overtake') { addTotal(L, 'passes', 1); sys.passes++; }
      else if (kind === 'drift') addTotal(L, 'drifts', 1);
      else if (kind === 'air' || kind === 'jump' || kind === 'stunt') addTotal(L, 'jumps', 1);
      else if (kind === 'takedown' || kind === 'chain') addTotal(L, 'takedowns', 1);
      else if (kind === 'escape') addTotal(L, 'escapes', 1);
    }
    return got;
  }

  // ---- clean passes: a moving car that was ahead is now behind ----
  function passes(v, speed) {
    const vs = game.vehicles;
    if (!vs) return;
    const fx = Math.cos(v.heading), fz = Math.sin(v.heading);
    for (let i = 0; i < vs.length; i++) {
      const o = vs[i];
      if (o === v || o.kind !== 'car' || !o.driver || o.wrecked || o.removed) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (dx > 30 || dx < -30 || dz > 30 || dz < -30) { o.flowAhead = 0; continue; }
      const along = dx * fx + dz * fz;
      const side = Math.abs(-dx * fz + dz * fx);
      const os = Math.abs(o.speed || 0);
      const same = Math.cos(o.heading - v.heading) > 0.5;
      if (along > 1 && along < PASS_AHEAD && side < PASS_SIDE && same && os > 2) {
        o.flowAhead = now; // being caught
      } else if (along < -1 && o.flowAhead > 0 && now - o.flowAhead < 3) {
        o.flowAhead = 0;
        if (side < PASS_SIDE + 1 && same && speed > os + PASS_FASTER && !(o.flowPassT > now) && !(o.nearMissT > now) && !(v.impact > 0) && !(o.flowHitT > now)) {
          o.flowPassT = now + PASS_COOL;
          feed('overtake', PASS_POINTS);
        }
      } else if (o.flowAhead > 0 && now - o.flowAhead >= 3) o.flowAhead = 0;
    }
  }

  // ---- crashes, rams, smashes ----
  let preSpeed = 0; // the car's speed one step before (a hard crash stops it)
  function hardCrash(v, impact) {
    if (!(impact > CRASH_MPS) || game.phoneCheckRunning) return;
    // A glancing scrape at speed is not a crash: the car must lose most of its speed.
    const sp = Math.abs(v.speed || 0);
    // Standing or crawling, the player is the one hit (a car into the back of one waiting to bank): no crash.
    if (preSpeed <= CRAWL_MPS || sp > preSpeed * HARD_STOP) return;
    flow.crash();
  }
  function onImpact(v, impact) {
    const p = game.player;
    if (!p || v !== p.vehicle) return;
    hardCrash(v, impact);
  }
  function onCrash(a, b, impact) {
    const p = game.player;
    const pv = p && p.vehicle;
    if (!pv || (a !== pv && b !== pv)) return;
    const o = a === pv ? b : a;
    if (o && o.kind === 'car') {
      o.flowHitT = now + 2;
      // Ramming a car that drives (or the police) pays; it is not a clean pass.
      // Only the player's own ram: moving, and the faster of the two (a car into the player pays nothing).
      const ps = Math.abs(pv.speed || 0);
      if (impact >= RAM_MPS && o.driver && ps > CRAWL_MPS && ps >= Math.abs(o.speed || 0) && !(o.flowRamT > now)) {
        o.flowRamT = now + 4;
        sys.rams++;
        feed('other', RAM_POINTS, 'Ram');
        kick(0, 2);
      }
    }
    hardCrash(pv, impact);
  }
  function onProp(b) {
    if (!b || !b.byPlayer) return;
    smashChain = now - smashT <= SMASH_CHAIN_S ? smashChain + 1 : 1;
    smashT = now;
    sys.smashes++;
    const L = loop();
    addTotal(L, 'smashes', 1);
    noteBest(L, 'chain', smashChain);
    feed('smash', SMASH_POINTS + SMASH_CHAIN_BONUS * Math.min(10, smashChain - 1), smashChain > 1 ? 'Smash x' + smashChain : 'Smash');
  }
  function onTakedown(t) {
    const tg = t && t.target;
    if (tg && tg.spec && tg.kind) sys.wrecks++;
  }
  const offs = events ? [
    events.on('vehicleImpact', onImpact),
    events.on('vehicleCrash', onCrash),
    events.on('propBreak', onProp),
    events.on('takedown', onTakedown),
    events.on('playerDown', () => flow.wipe()),
    events.on('busted', () => flow.wipe()),
    events.on('progressReset', () => { flow.reset(); flow.banked = 0; flow.best = 0; }),
    events.on('enter', (v) => { if (v && v.spec && v.kind === 'car' && noteVehicle(loop(), v.spec.id)) events.emit('progress'); }),
  ] : [];

  const facts = { speed: 0, driving: false, airborne: false, wanted: false, canBank: true };
  const sys = {
    name: 'flow',
    core: flow,
    feed,
    // Counters the street events read (they only ever grow).
    passes: 0, smashes: 0, rams: 0, wrecks: 0,
    get run() { return flow.run; },
    get tier() { return flow.tier; },
    get meter() { return flow.meter; },
    get nearMissChain() { return nmChain; },
    // A running event holds the bank back; its end banks the run.
    setEvent(on) { eventOn = !!on; },
    bank(how = 'event') { return flow.bank(how); },
    wipe() { return flow.wipe(); },
    dispose() { for (const off of offs) off(); },
    fixedUpdate(dt) {
      now += dt;
      const p = game.player;
      const v = p && p.vehicle;
      if (v !== lastVeh) {
        // Left the car (or it is gone): a wreck costs the run, getting out does not.
        if (lastVeh && lastVeh.wrecked) flow.wipe();
        lastVeh = v || null;
      }
      const speed = v ? Math.abs(v.speed || 0) : (p && p.walker ? Math.abs(p.walker.speed || 0) : 0);
      facts.speed = speed;
      facts.driving = !!v && (v.kind === 'car' || v.kind === 'boat');
      facts.airborne = !!v && ((v.air && v.air.on) || (v.kind !== 'plane' && v.kind !== 'heli' && (v.y || 0) > 0.3 && !v.stuntRamp));
      facts.wanted = (game.police ? game.police.stars : p ? p.wanted : 0) > 0;
      facts.canBank = !eventOn && !(v && (v.kind === 'plane' || v.kind === 'heli') && (v.y || 0) > 2);
      if (v && v.kind === 'car' && speed > PASS_SPEED && !v.wrecked) passes(v, speed);
      flow.step(dt, facts);
      preSpeed = speed;
      if (v && v.kind === 'car') noteBest(loop(), 'mph', speed * 2.23694);
      // Distance by region (the total is the economy's).
      if (p) {
        if (Number.isFinite(lx)) {
          const d = Math.hypot(p.x - lx, p.z - lz);
          if (d > 0 && d < 120) addDistance(loop(), slug, d);
        }
        lx = p.x;
        lz = p.z;
      }
    },
  };
  return sys;
}
