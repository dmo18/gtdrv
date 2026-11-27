// The Daily Three in the game (docs/LOOP.md section d). The phone's local
// date is read when the system is made and again by `refresh()` (called by
// the UI when the daily screen opens and when the page becomes visible
// again), through `opts.now` (a function returning a Date: injectable for
// tests). A refresh is deferred while an event run is active, so a challenge
// in flight is never reset. The simulation never looks at a clock. No
// network, no account.
import { dayKey, dailyThree, rollDay, completeDaily } from '../core/daily.js';
import { loopOf } from '../core/records.js';
import { VEHICLE_SPECS } from '../entities/vehicle.js';

const TIME_SLACK = 1.5; // hours either side of the twist's hour

export function createDaily(game, opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => new Date();
  let day = dayKey(now());
  const se = game.streetEvents;
  const labels = {};
  for (const id of Object.keys(VEHICLE_SPECS)) labels[id] = VEHICLE_SPECS[id].label;
  const pickFor = (d) => (se ? dailyThree(se.list, d, se.slug, labels) : []);
  let picks = pickFor(day);
  const state = () => rollDay(loopOf(game.progress).daily, day);
  const toast = (text, s) => { if (game.hud && game.hud.toast) game.hud.toast(text, s, 'info'); };

  function twistOk(t, v) {
    if (t.kind === 'class') return !!v && v.spec && v.spec.id === t.value;
    if (t.kind === 'weather') return !!game.weather && game.weather.name === t.value;
    const d = Math.abs((((game.clock || 0) - t.value + 36) % 24) - 12);
    return d <= TIME_SLACK;
  }
  // The daily slot this event counts for when started in vehicle `v` now, or -1.
  function slotFor(ev, v) {
    for (const p of picks) if (p.ev === ev && !state().done[p.slot] && twistOk(p.twist, v)) return p.slot;
    return -1;
  }
  // Set the scene of a daily and put the player at its gate. Returns '' or why not.
  function go(slot) {
    const p = picks.find((q) => q.slot === slot);
    if (!p || !se) return 'No daily here';
    if ((game.police ? game.police.stars : game.player.wanted) > 0) return 'Lose the police first';
    const t = p.twist;
    if (!se.stage(p.ev, t.kind === 'class' ? t.value : null)) return 'Get in a car first';
    if (t.kind === 'weather' && game.daynight && game.daynight.setWeather) game.daynight.setWeather(t.value, true);
    if (t.kind === 'time' && game.daynight && game.daynight.setHour) game.daynight.setHour(t.value);
    return '';
  }
  // The phone's date may have changed (a session left open overnight). Returns
  // true when the choices changed. Never while a run is active.
  function refresh() {
    if (se && se.active) return false;
    const d = dayKey(now());
    if (d === day) return false;
    day = d;
    picks = pickFor(d);
    return true;
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
  if (game.events) {
    game.events.on('streetEventEnd', (r) => {
      if (!r || !(r.daily >= 0) || !r.medal) return;
      const st = state();
      const how = completeDaily(st, day, r.daily);
      if (!how) return;
      const n = st.done.filter(Boolean).length;
      toast(how === 'all' ? 'Daily Three done!  Day ' + st.streak : 'Daily ' + n + ' of 3 done' + (how === 'first' ? '  Day ' + st.streak : ''), 3.5);
      if (game.loopSave) game.loopSave(); else game.events.emit('progress');
    });
  }
  return {
    name: 'daily',
    get day() { return day; },
    get picks() { return picks; },
    refresh,
    slotFor,
    go,
    get state() { return state(); },
    get doneCount() { return state().done.filter(Boolean).length; },
  };
}
