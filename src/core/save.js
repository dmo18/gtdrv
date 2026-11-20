// Saving and loading progress. Saved text lives in localStorage where
// anyone can edit it, so everything read back is treated as untrusted
// and rebuilt field by field from safe defaults.
//
// Version 2 (docs/MISSIONS.md "Score"): no money, no owned craft; the
// only progression is score, high scores, best times and medals.
// Version 1 saves (no `version` field: money, owned, medals, ...) are
// migrated on load: money x 10 becomes the starting total score,
// `owned` is dropped (everything is free), and medals (including the
// `hint_` and `seen_` flags kept in that map), best times, stats and
// settings carry over unchanged. The storage key keeps its old name so
// those saves are found.
//
// Version 3 adds `session`: the last place and craft and a small garage of
// cars left behind (core/garage.js). Version 2 saves load unchanged with
// no session. Wanted level is never saved.
import { sanitizeSession } from './garage.js';

export const SAVE_KEY = 'rustwater.save.v1';
export const SAVE_VERSION = 3;
const SCORE_VERSION = 2; // first version that keeps `score`

const MAX_NUM = 1e9;
const MAX_MONEY = 99999999; // v1 only: the old cap, used by the migration
const MAX_KEYS = 200;
const MAX_SCAN = 2000; // never look at more than this many keys of an object
const MAX_TEXT = 100000;
const KEY_RE = /^[a-z0-9_-]{1,40}$/;
const MEDALS = ['bronze', 'silver', 'gold'];
const QUALITIES = [0.75, 1, 1.25];
const STEERING = ['wheel', 'buttons', 'tilt', 'slider'];
const HANDLING = ['arcade', 'sim'];
const HUD_MODES = ['minimal', 'full'];
const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
const BEST_KEYS = ['combo', 'jump', 'airtime', 'drift', 'nearMiss'];

export function defaultProgress() {
  return {
    version: SAVE_VERSION,
    score: {
      total: 0, // lifetime points
      sessionBest: 0, // most points banked in one play session
      best: { combo: 0, jump: 0, airtime: 0, drift: 0, nearMiss: 0 },
      missions: {}, // id -> { best, time, done }
      courses: {}, // id -> best points from one run
    },
    medals: {},
    bestTimes: {},
    stats: { distance: 0, flights: 0, races: 0 },
    session: null, // last place, craft and garage (null = new game)
    settings: {
      master: 0.8, invertPitch: false, leftHanded: false, quality: 1, police: true,
      steering: 'wheel', steerSensitivity: 1, handling: 'arcade', hud: 'minimal',
    },
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const goodKey = (k) => KEY_RE.test(k) && !BAD_KEYS.includes(k);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// A finite number clamped to 0..max, or `fallback` for anything else.
const clampNum = (v, max = MAX_NUM, fallback = 0) => (isNum(v) ? Math.max(0, Math.min(max, v)) : fallback);

function readMap(src, accept) {
  const out = {};
  if (!isObj(src)) return out;
  let scanned = 0, n = 0;
  for (const k in src) {
    if (++scanned > MAX_SCAN || n >= MAX_KEYS) break;
    if (!own(src, k) || !goodKey(k)) continue;
    const v = accept(src[k]);
    if (v === undefined) continue;
    out[k] = v;
    n++;
  }
  return out;
}

function readScore(src, dst) {
  if (!isObj(src)) return;
  dst.total = Math.floor(clampNum(src.total));
  dst.sessionBest = Math.floor(clampNum(src.sessionBest));
  if (isObj(src.best)) {
    for (const k of BEST_KEYS) {
      if (own(src.best, k)) dst.best[k] = Math.round(clampNum(src.best[k]) * 100) / 100;
    }
    dst.best.combo = Math.min(dst.best.combo, 5);
  }
  dst.missions = readMap(src.missions, (v) => {
    if (!isObj(v)) return undefined;
    return {
      best: Math.floor(clampNum(v.best)),
      time: clampNum(v.time, 86400),
      done: v.done === true,
    };
  });
  dst.courses = readMap(src.courses, (v) => (isNum(v) ? Math.floor(clampNum(v)) : undefined));
}

export function sanitizeProgress(raw) {
  const p = defaultProgress();
  try {
    if (!isObj(raw)) return p;
    if (own(raw, 'version') && Number.isInteger(raw.version) && raw.version >= SCORE_VERSION) {
      readScore(raw.score, p.score);
    } else if (own(raw, 'money') && isNum(raw.money)) {
      // Version 1: the old money becomes the starting total score.
      p.score.total = Math.floor(clampNum(raw.money, MAX_MONEY)) * 10;
    }
    if (own(raw, 'session')) p.session = sanitizeSession(raw.session);
    p.medals = readMap(raw.medals, (v) => (MEDALS.includes(v) ? v : undefined));
    p.bestTimes = readMap(raw.bestTimes, (v) => (
      isNum(v) && v > 0 && v < 86400 ? v : undefined));
    if (isObj(raw.stats)) {
      for (const k of ['distance', 'flights', 'races']) {
        const v = own(raw.stats, k) ? raw.stats[k] : undefined;
        if (isNum(v) && v >= 0) p.stats[k] = Math.min(v, 1e12);
      }
    }
    if (isObj(raw.settings)) {
      const s = raw.settings, d = p.settings;
      if (own(s, 'master') && isNum(s.master)) d.master = Math.max(0, Math.min(1, s.master));
      if (own(s, 'musicVol') && isNum(s.musicVol)) d.musicVol = Math.max(0, Math.min(1, s.musicVol));
      for (const k of ['invertPitch', 'leftHanded', 'police', 'music']) {
        if (own(s, k) && typeof s[k] === 'boolean') d[k] = s[k];
      }
      if (own(s, 'quality') && QUALITIES.includes(s.quality)) d.quality = s.quality;
      if (own(s, 'steering') && STEERING.includes(s.steering)) d.steering = s.steering;
      if (own(s, 'handling') && HANDLING.includes(s.handling)) d.handling = s.handling;
      if (own(s, 'hud') && HUD_MODES.includes(s.hud)) d.hud = s.hud;
      if (own(s, 'steerSensitivity') && isNum(s.steerSensitivity)) {
        d.steerSensitivity = Math.round(Math.max(0.5, Math.min(1.5, s.steerSensitivity)) * 100) / 100;
      }
    }
  } catch {
    return defaultProgress();
  }
  return p;
}

export function loadProgress(storage) {
  let raw = null;
  try {
    const text = storage ? storage.getItem(SAVE_KEY) : null;
    if (typeof text === 'string' && text.length <= MAX_TEXT) raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  return sanitizeProgress(raw);
}

export function saveProgress(storage, progress) {
  try {
    if (!storage) return false;
    // Written through the sanitiser so only known, valid fields are stored.
    storage.setItem(SAVE_KEY, JSON.stringify(sanitizeProgress({ ...progress, version: SAVE_VERSION })));
    return true;
  } catch {
    return false;
  }
}
