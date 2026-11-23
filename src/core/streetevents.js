// Street events (docs/LOOP.md section b): six templates, their medal
// targets by formula, and the run of one event. Pure logic: fixed steps,
// no DOM, no three.js, no allocation per step. Placement is in
// world/eventspots.js, the game wiring in systems/events.js.
// (This file is not core/events.js, which is the publish/subscribe hub.)
import { KMH_TO_MPH, formatDistance } from './units.js';

export const TEMPLATES = ['trap', 'miss', 'jump', 'dash', 'heat', 'wreck'];
export const MEDALS = ['bronze', 'silver', 'gold'];
// Per template: the title, the unit of its value and whether more is better.
export const TEMPLATE_INFO = {
  trap: { title: 'Speed trap', more: true, color: '#ffcf5a', icon: 'race' },
  miss: { title: 'Traffic run', more: true, color: '#45c7dc', icon: 'street' },
  jump: { title: 'Jump', more: true, color: '#b48cff', icon: 'stunt' },
  dash: { title: 'Rush drop', more: false, color: '#8bd66f', icon: 'delivery' },
  heat: { title: 'Heat escape', more: false, color: '#ff5a4a', icon: 'depot' },
  wreck: { title: 'Wrecking spree', more: true, color: '#ff9a3a', icon: 'landmark' },
};

const MPS_TO_MPH = 3.6 * KMH_TO_MPH;
const FT = 3.28084;
const G = 9.81;
export const mph = (mps) => mps * MPS_TO_MPH;
export const mps = (m) => m / MPS_TO_MPH;

// ---- Targets (one formula per template) --------------------------------
// Speed a car reaches from a rolling start over `runup` meters, capped.
export const RUN_V0 = 13, RUN_ACCEL = 2.6;
export function refSpeed(runup, cap) {
  return Math.min(cap, Math.sqrt(RUN_V0 * RUN_V0 + 2 * RUN_ACCEL * Math.max(0, runup)));
}
const triple = (gold, silver, bronze) => ({ gold, silver, bronze });

// Speed trap: shares of the reference speed at the line, in whole mph.
export const TRAP_CAP = 42, TRAP_SHARE = [0.92, 0.78, 0.62], TRAP_LIMIT = 30;
export function trapTargets(runup) {
  const v = mph(refSpeed(runup, TRAP_CAP));
  return triple(Math.round(v * TRAP_SHARE[0]), Math.round(v * TRAP_SHARE[1]), Math.round(v * TRAP_SHARE[2]));
}

// Traffic run: close passes (near misses and clean passes) in the time.
// `busy`: 1 on a main road, less on a quiet street.
export const MISS_LIMIT = 45, MISS_RATE = 0.16;
export function missTargets(limit = MISS_LIMIT, busy = 1) {
  const gold = Math.max(4, Math.round(limit * MISS_RATE * busy));
  return triple(gold, Math.max(3, Math.round(gold * 0.65)), Math.max(2, Math.round(gold * 0.4)));
}

// Jump: flight distance off a tabletop ramp (height h, slope angle) at a
// share of the reference speed, in whole feet. The flight is ballistic
// from the top of the ramp (systems/stunts.js).
export const JUMP_CAP = 33, JUMP_SHARE = [0.9, 0.74, 0.58], JUMP_LIMIT = 25;
export function jumpDistance(v, angle, h) {
  const vy = v * Math.tan(angle);
  return v * (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
}
export function jumpTargets(runup, angle, h) {
  const v = refSpeed(runup, JUMP_CAP);
  const ft = (k) => Math.round(jumpDistance(v * k, angle, h) * FT);
  return triple(ft(JUMP_SHARE[0]), ft(JUMP_SHARE[1]), ft(JUMP_SHARE[2]));
}

// Rush drop: seconds for `meters` of road at an average speed, plus a start.
export const DASH_SPEED = 17, DASH_START = 6, DASH_FACTOR = [1, 1.25, 1.6], DASH_OVER = 1.2;
export function dashTargets(meters) {
  const g = DASH_START + Math.max(0, meters) / DASH_SPEED;
  return triple(Math.round(g * DASH_FACTOR[0]), Math.round(g * DASH_FACTOR[1]), Math.round(g * DASH_FACTOR[2]));
}
export const dashLimit = (targets) => Math.min(90, Math.round(targets.bronze * DASH_OVER));

// Heat escape: the seconds out of sight the level needs, plus a margin.
export const HEAT_COOL = [0, 12, 18, 25], HEAT_MARGIN = [12, 26, 45], HEAT_LIMIT = 90;
export function heatTargets(level) {
  const base = HEAT_COOL[Math.max(1, Math.min(3, level | 0))];
  return triple(base + HEAT_MARGIN[0], base + HEAT_MARGIN[1], base + HEAT_MARGIN[2]);
}

// Wrecking spree: things smashed in the time. `dense`: 1 on a street with
// sidewalks full of props, less elsewhere.
export const WRECK_LIMIT = 40, WRECK_RATE = 0.3;
export function wreckTargets(limit = WRECK_LIMIT, dense = 1) {
  const gold = Math.max(5, Math.round(limit * WRECK_RATE * dense));
  return triple(gold, Math.max(3, Math.round(gold * 0.65)), Math.max(2, Math.round(gold * 0.4)));
}
export const WRECK_POINTS = { prop: 1, ram: 2, craft: 3 }; // what one smash counts

// ---- Medals ---------------------------------------------------------------
export const medalRank = (m) => (m === 'gold' ? 3 : m === 'silver' ? 2 : m === 'bronze' ? 1 : 0);
// The medal a value earns on an event, or null.
export function medalFor(ev, value) {
  const t = ev.targets, more = TEMPLATE_INFO[ev.tpl].more;
  if (!Number.isFinite(value)) return null;
  for (let i = 2; i >= 0; i--) {
    const m = MEDALS[i];
    if (more ? value >= t[m] : value <= t[m]) return m;
  }
  return null;
}
// True when `a` beats `b` as a best value of this template (b may be absent).
export function better(tpl, a, b) {
  if (!Number.isFinite(b)) return Number.isFinite(a);
  return TEMPLATE_INFO[tpl].more ? a > b : a < b;
}
// The value as the player reads it: "81 mph", "5", "118 ft", "0:42".
export function clock(s) {
  const t = Math.max(0, Math.round(s));
  const m = Math.floor(t / 60), r = t - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
export function valueText(tpl, v) {
  if (!Number.isFinite(v)) return '-';
  if (tpl === 'trap') return Math.round(v) + ' mph';
  if (tpl === 'jump') return Math.round(v) + ' ft';
  if (tpl === 'dash' || tpl === 'heat') return clock(v);
  return String(Math.round(v));
}
// Score for a finished event: a medal's worth plus a bonus for a new best
// value. No medal, no points (the try still counts).
export const POINTS = { gold: 3000, silver: 2000, bronze: 1000, best: 500 };
export function eventPoints(medal, newBest) {
  return POINTS[medal] ? POINTS[medal] + (newBest ? POINTS.best : 0) : 0;
}

// ---- One run ---------------------------------------------------------------
export const GATE_MIN_SPEED = 3; // m/s through the gate to start
export const DASH_ARRIVE = 24; // m from the drop point (more than the GPS's own 22 m, so the event ends first)
export const END_HOLD = 0.6; // seconds a counting event lingers after gold (the last pass lands)

// facts for step(): { x, z, px, pz (the craft now and one step ago), speed
// (m/s), inCar, wrecked, passes, smashes (counted this step), jump (meters
// of a landed jump, 0 none, < 0 a bad landing), escaped, busted, stars }.
export function createEventRun() {
  const st = {
    ev: null, on: false, t: 0, value: NaN, count: 0, result: '', why: '', medal: null, armed: false, endT: 0,
  };
  st.start = function start(ev) {
    st.ev = ev;
    st.on = true;
    st.t = 0;
    st.value = NaN;
    st.count = 0;
    st.result = '';
    st.why = '';
    st.medal = null;
    st.armed = false;
    st.endT = 0;
    return st;
  };
  function end(result, why) {
    st.on = false;
    st.result = result;
    st.why = why || '';
    st.medal = result === 'done' ? medalFor(st.ev, st.value) : null;
    return result;
  }
  st.abort = (why = 'Left the event') => (st.on ? end('fail', why) : '');
  // One fixed step. Returns '' (running), 'done' or 'fail'.
  st.step = function step(dt, f) {
    if (!st.on) return '';
    const ev = st.ev;
    st.t += dt;
    if (!f.inCar) return end('fail', 'Left the car');
    if (f.wrecked) return end('fail', 'Wrecked');
    const tpl = ev.tpl;
    if (tpl === 'trap') {
      // The line: across the street at (tx, tz), crossed along (dx, dz).
      const a0 = (f.px - ev.tx) * ev.dx + (f.pz - ev.tz) * ev.dz;
      const a1 = (f.x - ev.tx) * ev.dx + (f.z - ev.tz) * ev.dz;
      if (a0 < 0 && a1 >= 0 && Math.abs(-(f.x - ev.tx) * ev.dz + (f.z - ev.tz) * ev.dx) <= ev.w + 4) {
        st.value = mph(f.speed);
        return end('done');
      }
    } else if (tpl === 'miss' || tpl === 'wreck') {
      st.count += tpl === 'miss' ? f.passes || 0 : f.smashes || 0;
      st.value = st.count;
      if (st.count >= ev.targets.gold) {
        st.endT += dt;
        if (st.endT >= END_HOLD) return end('done');
      }
      if (st.t >= ev.limit) return end('done');
      return '';
    } else if (tpl === 'jump') {
      if (f.jump > 0) {
        st.value = f.jump * FT;
        return end('done');
      }
      if (f.jump < 0) return end('fail', 'Bad landing');
    } else if (tpl === 'dash') {
      const dx = f.x - ev.tx, dz = f.z - ev.tz;
      if (dx * dx + dz * dz <= DASH_ARRIVE * DASH_ARRIVE) {
        st.value = st.t;
        return end('done');
      }
    } else if (tpl === 'heat') {
      if (f.stars > 0) st.armed = true;
      if (f.busted) return end('fail', 'Pulled over');
      if (f.escaped || (st.armed && !(f.stars > 0))) {
        st.value = st.t;
        return end('done');
      }
    }
    if (st.t >= ev.limit) return end('fail', 'Out of time');
    return '';
  };
  return st;
}

// The one status line for the prompt strip (at most about 24 characters).
// Rebuilt only when `key` changes (the caller compares st.lineKey).
export function statusKey(st, dist) {
  if (!st.on) return -1;
  const left = Math.max(0, Math.ceil(st.ev.limit - st.t));
  const tpl = st.ev.tpl;
  if (tpl === 'miss' || tpl === 'wreck') return st.count * 1000 + left;
  if (tpl === 'dash') return Math.floor(st.t) * 1000 + Math.min(999, Math.round((dist || 0) / 20));
  if (tpl === 'heat') return Math.floor(st.t);
  return left * 1000 + Math.min(999, Math.round((dist || 0) / 10));
}
export function statusLine(st, dist) {
  if (!st.on) return '';
  const ev = st.ev, t = ev.targets;
  const left = clock(Math.max(0, Math.ceil(ev.limit - st.t)));
  const far = formatDistance(Math.round((dist || 0) / 3) * 3); // "320 ft", "0.3 mi"
  switch (ev.tpl) {
    case 'trap': return 'Trap ' + far + ' · gold ' + t.gold + ' mph';
    case 'miss': return 'Passes ' + st.count + '/' + nextTarget(ev, st.count) + ' · ' + left;
    case 'jump': return 'Ramp ' + far + ' · gold ' + t.gold + ' ft';
    case 'dash': return clock(st.t) + ' · gold ' + clock(t.gold);
    case 'heat': return 'Lose them ' + clock(st.t) + ' · gold ' + clock(t.gold);
    default: return 'Smashed ' + st.count + '/' + nextTarget(ev, st.count) + ' · ' + left;
  }
}
// The next medal target above a count (the gold one once past it).
export function nextTarget(ev, n) {
  const t = ev.targets;
  return n < t.bronze ? t.bronze : n < t.silver ? t.silver : t.gold;
}
// The line shown on driving through the gate: what to do and the targets.
export function startLine(ev) {
  const t = ev.targets, v = (m) => valueText(ev.tpl, t[m]);
  switch (ev.tpl) {
    case 'trap': return 'Speed trap ahead: ' + v('bronze') + ' for bronze';
    case 'miss': return 'Pass cars close: ' + t.bronze + ' for bronze';
    case 'jump': return 'Hit the ramp: ' + v('bronze') + ' for bronze';
    case 'dash': return 'Rush drop: ' + v('bronze') + ' for bronze';
    case 'heat': return 'Lose the police: ' + v('bronze') + ' for bronze';
    default: return 'Smash everything: ' + t.bronze + ' for bronze';
  }
}
export const cap = (m) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : '');
export function resultLine(st) {
  const ev = st.ev;
  if (st.result === 'fail') return TEMPLATE_INFO[ev.tpl].title + ': ' + st.why;
  const v = valueText(ev.tpl, st.value);
  return (st.medal ? cap(st.medal) + '! ' : 'No medal: ') + v + (st.medal === 'gold' ? '' : ' (' + nextMedal(st.medal) + ' ' + valueText(ev.tpl, ev.targets[nextMedal(st.medal)]) + ')');
}
export const nextMedal = (m) => (m === 'silver' ? 'gold' : m === 'bronze' ? 'silver' : 'bronze');
