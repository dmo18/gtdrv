// The Records board's data (docs/LOOP.md section c): medals and best values
// by event, the best flow run by region, totals, vehicles driven and the
// distance by region. Pure rules over `progress.loop` (core/save.js keeps
// and sanitizes it). No DOM, no three.js, no clock.
import { medalRank, better, TEMPLATES, TEMPLATE_INFO } from './streetevents.js';

export const REGION_SLUGS = ['beach', 'downtown', 'north', 'west', 'south', 'miami', 'island'];
export const REGION_NAMES = { beach: 'Miami Beach', downtown: 'Downtown', north: 'North Side', west: 'Little Havana', south: 'South Shore', miami: 'All of Miami', island: 'The Island' };
export const TOTAL_KEYS = ['banked', 'runs', 'nearMiss', 'passes', 'drifts', 'jumps', 'takedowns', 'smashes', 'escapes', 'events', 'crashes'];
export const BEST_KEYS = ['mph', 'jumpFt', 'tier', 'chain'];
export const EVENT_ID = /^ev_[a-z]{4,8}_(trap|miss|jump|dash|heat|wreck)_\d{1,2}$/;
export const MAX_EVENTS = 320, MAX_DRIVEN = 40, MAX_VALUE = 1e9;

export function defaultLoop() {
  const totals = {}, best = {};
  for (const k of TOTAL_KEYS) totals[k] = 0;
  for (const k of BEST_KEYS) best[k] = 0;
  return {
    events: {}, // id -> { m: medal or '', b: best value, n: tries }
    flow: {}, // region -> biggest banked run
    dist: {}, // region -> meters driven, walked, sailed and flown
    totals, best,
    driven: [], // spec ids of the vehicles driven
    daily: { day: 0, done: [false, false, false], streak: 0 },
    intro: { step: 0, done: false },
    looks: {}, // spec id -> { paint, finish, wheels, tint, decal }
  };
}

// The loop record of a progress object (made when missing: old saves, tests).
export function loopOf(progress) {
  if (!progress.loop) progress.loop = defaultLoop();
  return progress.loop;
}

// A finished run of an event: keeps the best medal and the best value.
// Returns { medal: the best medal now, newMedal, newBest, prev }.
const RES = { medal: '', newMedal: false, newBest: false, prev: NaN };
export function recordEvent(loop, ev, value, medal) {
  let r = loop.events[ev.id];
  if (!r) {
    if (Object.keys(loop.events).length >= MAX_EVENTS) { RES.medal = medal || ''; RES.newMedal = false; RES.newBest = false; RES.prev = NaN; return RES; }
    r = loop.events[ev.id] = { m: '', b: NaN, n: 0 };
  }
  r.n = Math.min(99999, r.n + 1);
  RES.prev = r.b;
  RES.newBest = Number.isFinite(value) && better(ev.tpl, value, r.b);
  if (RES.newBest) r.b = Math.round(value * 100) / 100;
  RES.newMedal = medalRank(medal) > medalRank(r.m);
  if (RES.newMedal) r.m = medal;
  RES.medal = r.m;
  loop.totals.events = Math.min(MAX_VALUE, loop.totals.events + 1);
  return RES;
}
// An event given up or failed still counts as a try.
// The first failed try makes the empty record (no medal, no best), within
// the same event limit as a finished run.
export function recordTry(loop, ev) {
  let r = loop.events[ev.id];
  if (!r) {
    if (Object.keys(loop.events).length >= MAX_EVENTS) return;
    r = loop.events[ev.id] = { m: '', b: NaN, n: 0 };
  }
  r.n = Math.min(99999, r.n + 1);
}

// A banked flow run. Returns true when it is the region's best.
export function recordBank(loop, slug, amount) {
  if (!(amount > 0)) return false;
  loop.totals.banked = Math.min(MAX_VALUE, loop.totals.banked + Math.round(amount));
  loop.totals.runs = Math.min(MAX_VALUE, loop.totals.runs + 1);
  if (!REGION_SLUGS.includes(slug)) return false;
  if (amount > (loop.flow[slug] || 0)) {
    loop.flow[slug] = Math.min(MAX_VALUE, Math.round(amount));
    return true;
  }
  return false;
}
export function addTotal(loop, key, n = 1) {
  if (Object.hasOwn(loop.totals, key) && n > 0) loop.totals[key] = Math.min(MAX_VALUE, loop.totals[key] + n);
}
export function noteBest(loop, key, v) {
  if (Object.hasOwn(loop.best, key) && v > loop.best[key]) { loop.best[key] = Math.round(v * 10) / 10; return true; }
  return false;
}
export function addDistance(loop, slug, meters) {
  if (REGION_SLUGS.includes(slug) && meters > 0) loop.dist[slug] = Math.min(1e12, (loop.dist[slug] || 0) + meters);
}
// Returns true the first time a vehicle class is driven.
export function noteVehicle(loop, specId) {
  if (typeof specId !== 'string' || loop.driven.includes(specId) || loop.driven.length >= MAX_DRIVEN) return false;
  loop.driven.push(specId);
  return true;
}

// Medal counts over every saved event, or one region's ("ev_<slug>_").
export function medalCounts(loop, slug = null) {
  const out = { gold: 0, silver: 0, bronze: 0, any: 0, tried: 0 };
  const pre = slug ? 'ev_' + slug + '_' : 'ev_';
  for (const id in loop.events) {
    if (!id.startsWith(pre)) continue;
    const r = loop.events[id];
    out.tried++;
    if (r.m) { out[r.m]++; out.any++; }
  }
  return out;
}
export const bestFlow = (loop) => REGION_SLUGS.reduce((m, s) => Math.max(m, loop.flow[s] || 0), 0);
export const totalDistance = (loop) => REGION_SLUGS.reduce((m, s) => m + (loop.dist[s] || 0), 0);

// The board's rows for a region's event list: per template the medals
// earned out of the events there, and the events themselves in order.
export function boardRows(loop, events) {
  const rows = [];
  for (const tpl of TEMPLATES) {
    const list = events.filter((e) => e.tpl === tpl);
    if (!list.length) continue;
    const row = { tpl, title: TEMPLATE_INFO[tpl].title, total: list.length, gold: 0, silver: 0, bronze: 0, items: [] };
    for (const e of list) {
      const r = loop.events[e.id] || null;
      if (r && r.m) row[r.m]++;
      row.items.push({ ev: e, medal: r ? r.m : '', best: r ? r.b : NaN, tries: r ? r.n : 0 });
    }
    rows.push(row);
  }
  return rows;
}
// The three events closest to their next medal: no medal first (tried
// ones before untried), then bronze, then silver. Gold ones are done.
export function closestMedals(loop, events, n = 3) {
  const score = (e) => {
    const r = loop.events[e.id];
    if (!r) return 1;
    return r.m === 'gold' ? 9 : r.m === 'silver' ? 3 : r.m === 'bronze' ? 2 : 0;
  };
  return events.filter((e) => score(e) < 9).map((e, i) => ({ e, s: score(e), i })).sort((a, b) => a.s - b.s || a.i - b.i).slice(0, n).map((x) => x.e);
}
