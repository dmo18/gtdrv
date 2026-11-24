// The loop's host (docs/LOOP.md). Missions stay out (docs/PLAN_V3.md 2.9
// item 7); this system, which game.js has always registered as
// `game.missions`, now carries the fun loop instead: Flow (game.flow), the
// street events (game.streetEvents), the Daily Three (game.daily) and the
// looks (game.custom). It is built before the score and the stunt systems,
// so the score finds game.flow and the stunt system finds the events' ramps.
// `objective` is what systems/objective.js reads for the arrow and the GPS.
import { createFlowSystem } from './flow.js';
import { createStreetEvents } from './events.js';
import { createDaily } from './daily.js';
import { createCustom } from './custom.js';

export const SAVE_SPEED = 2, SAVE_WAIT = 8; // m/s and seconds: when a change of the loop is written to storage

export function createMissions(game, uiRoot) {
  const parts = [];
  const add = (key, make) => {
    try {
      const s = make();
      if (s) { game[key] = s; parts.push(s); }
    } catch (e) {
      // One part failing must not take the game down (the island has no real streets).
      if (game.errors && game.errors.report) game.errors.report('loop.' + key, e);
      else throw e;
    }
  };
  if (game.events && game.player) {
    add('flow', () => createFlowSystem(game));
    if (game.city && Array.isArray(game.city.edges)) add('streetEvents', () => createStreetEvents(game));
    if (game.streetEvents) add('daily', () => createDaily(game));
    add('custom', () => createCustom(game));
  }
  // What the loop changed is saved at the next quiet moment: the car slow, or
  // SAVE_WAIT seconds on. (A save is a few milliseconds of work: never in the
  // step a medal or a callout lands in. Leaving the page saves as always.)
  let saveDue = false, saveT = 0;
  game.loopSave = () => { saveDue = true; };
  function stepSave(dt) {
    if (!saveDue) return;
    saveT += dt;
    const v = game.player ? game.player.vehicle : null;
    const speed = v ? Math.abs(v.speed || 0) : 0;
    if (speed < SAVE_SPEED || saveT >= SAVE_WAIT) {
      saveDue = false;
      saveT = 0;
      game.events.emit('progress');
    }
  }
  return {
    name: 'missions',
    game,
    root: uiRoot || null,
    active: null,
    parts,
    start() {
      return false;
    },
    get objective() {
      return game.streetEvents ? game.streetEvents.objective : null;
    },
    fixedUpdate(dt) {
      for (let i = 0; i < parts.length; i++) if (parts[i].fixedUpdate) parts[i].fixedUpdate(dt);
      stepSave(dt);
    },
    render(alpha, dt) {
      for (let i = 0; i < parts.length; i++) if (parts[i].render) parts[i].render(alpha, dt);
    },
  };
}
