// The Daily Three (docs/LOOP.md section d): three of the region's events a
// day, picked by a seed from the phone's local date, each with a small
// twist (vehicle class, weather, time of day). A streak that counts the
// days played and never falls. Pure: the date comes in as a number.
import { createRng } from './rng.js';

// yyyymmdd of a local date (the only place a real date is read: once at
// start, through an injectable function in systems/daily.js).
export function dayKey(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(2026, 0, 1);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
export const validDay = (k) => Number.isInteger(k) && k >= 20200101 && k <= 29991231;

// One easy, one skill, one mayhem.
export const GROUPS = [['trap', 'jump'], ['miss', 'dash'], ['heat', 'wreck']];
export const GROUP_NAMES = ['Easy', 'Skill', 'Mayhem'];
export const TWIST_CLASSES = ['muscle', 'pickup', 'sports', 'compact', 'van', 'suv', 'convertible', 'sedan'];
export const TWIST_WEATHER = [['rain', 'in the rain'], ['fog', 'in the fog'], ['overcast', 'under gray skies']];
export const TWIST_TIMES = [[23, 'at midnight'], [6, 'at dawn'], [12.5, 'at noon'], [19.2, 'at sunset']];
export const TWIST_KINDS = ['class', 'weather', 'time'];

const hashOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// The three picks for a day in a region: [{ slot, group, ev, twist: { kind,
// value, text } }]. `labels`: spec id -> the class name shown ("Redtail").
// A group with no event in the region is left out.
export function dailyThree(events, day, slug, labels = {}) {
  const rng = createRng((Math.imul(day >>> 0, 2654435761) ^ hashOf(slug || '')) >>> 0);
  // which twist each slot gets: a seeded order of the three kinds
  const kinds = TWIST_KINDS.slice();
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t;
  }
  const out = [];
  for (let g = 0; g < GROUPS.length; g++) {
    const pool = events.filter((e) => GROUPS[g].includes(e.tpl) && !e.intro);
    const pick = rng.next(), tw = rng.next();
    if (!pool.length) continue;
    const ev = pool[Math.floor(pick * pool.length)];
    const kind = kinds[g];
    let twist;
    if (kind === 'class') {
      const id = TWIST_CLASSES[Math.floor(tw * TWIST_CLASSES.length)];
      twist = { kind, value: id, text: 'in a ' + (labels[id] || id) };
    } else if (kind === 'weather') {
      const w = TWIST_WEATHER[Math.floor(tw * TWIST_WEATHER.length)];
      twist = { kind, value: w[0], text: w[1] };
    } else {
      const t = TWIST_TIMES[Math.floor(tw * TWIST_TIMES.length)];
      twist = { kind, value: t[0], text: t[1] };
    }
    out.push({ slot: g, group: GROUP_NAMES[g], ev, twist });
  }
  return out;
}

// The saved state moved to `day`: a new day clears the three ticks and
// keeps the streak (a missed day costs nothing).
export function rollDay(state, day) {
  if (!validDay(day)) return state;
  if (state.day !== day) {
    state.day = day;
    state.done[0] = state.done[1] = state.done[2] = false;
  }
  return state;
}
// A daily finished with a medal. The first one of a day adds to the
// streak. Returns 'first' (streak grew), 'more', 'all' (third of the day)
// or '' (already done).
export function completeDaily(state, day, slot) {
  rollDay(state, day);
  if (!(slot >= 0 && slot < 3) || state.done[slot]) return '';
  const first = !state.done[0] && !state.done[1] && !state.done[2];
  state.done[slot] = true;
  if (first) state.streak = Math.min(99999, state.streak + 1);
  if (state.done[0] && state.done[1] && state.done[2]) return 'all';
  return first ? 'first' : 'more';
}
