// Saving and loading progress. Saved text lives in localStorage where
// anyone can edit it, so everything read back is treated as untrusted
// and rebuilt field by field from safe defaults.
export const SAVE_KEY = 'rustwater.save.v1';

const MAX_MONEY = 99999999;
const MAX_OWNED = 64;
const MAX_KEYS = 200;
const MAX_SCAN = 2000; // never look at more than this many keys of an object
const MAX_TEXT = 100000;
const KEY_RE = /^[a-z0-9_-]{1,40}$/;
const MEDALS = ['bronze', 'silver', 'gold'];
const QUALITIES = [0.75, 1, 1.25];
const STEERING = ['wheel', 'buttons', 'tilt', 'slider'];
const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];

export function defaultProgress() {
  return {
    money: 250,
    owned: [],
    medals: {},
    bestTimes: {},
    stats: { distance: 0, flights: 0, races: 0 },
    settings: {
      master: 0.8, invertPitch: false, leftHanded: false, quality: 1, police: true,
      steering: 'wheel', steerSensitivity: 1,
    },
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const goodKey = (k) => KEY_RE.test(k) && !BAD_KEYS.includes(k);

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

export function sanitizeProgress(raw, validSpecIds = []) {
  const p = defaultProgress();
  try {
    if (!isObj(raw)) return p;
    if (own(raw, 'money') && typeof raw.money === 'number' && Number.isFinite(raw.money)) {
      p.money = Math.max(0, Math.min(MAX_MONEY, Math.floor(raw.money)));
    }
    if (Array.isArray(raw.owned)) {
      const allow = new Set(Array.isArray(validSpecIds) ? validSpecIds : []);
      const lim = Math.min(raw.owned.length, MAX_SCAN);
      for (let i = 0; i < lim && p.owned.length < MAX_OWNED; i++) {
        const id = raw.owned[i];
        if (typeof id === 'string' && allow.has(id) && !p.owned.includes(id)) p.owned.push(id);
      }
    }
    p.medals = readMap(raw.medals, (v) => (MEDALS.includes(v) ? v : undefined));
    p.bestTimes = readMap(raw.bestTimes, (v) => (
      typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 86400 ? v : undefined));
    if (isObj(raw.stats)) {
      for (const k of ['distance', 'flights', 'races']) {
        const v = own(raw.stats, k) ? raw.stats[k] : undefined;
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) p.stats[k] = Math.min(v, 1e12);
      }
    }
    if (isObj(raw.settings)) {
      const s = raw.settings, d = p.settings;
      if (own(s, 'master') && typeof s.master === 'number' && Number.isFinite(s.master)) {
        d.master = Math.max(0, Math.min(1, s.master));
      }
      for (const k of ['invertPitch', 'leftHanded', 'police']) {
        if (own(s, k) && typeof s[k] === 'boolean') d[k] = s[k];
      }
      if (own(s, 'quality') && QUALITIES.includes(s.quality)) d.quality = s.quality;
      if (own(s, 'steering') && STEERING.includes(s.steering)) d.steering = s.steering;
      if (own(s, 'steerSensitivity') && typeof s.steerSensitivity === 'number' && Number.isFinite(s.steerSensitivity)) {
        d.steerSensitivity = Math.round(Math.max(0.5, Math.min(1.5, s.steerSensitivity)) * 100) / 100;
      }
    }
  } catch {
    return defaultProgress();
  }
  return p;
}

export function loadProgress(storage, validSpecIds = []) {
  let raw = null;
  try {
    const text = storage ? storage.getItem(SAVE_KEY) : null;
    if (typeof text === 'string' && text.length <= MAX_TEXT) raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  return sanitizeProgress(raw, validSpecIds);
}

export function saveProgress(storage, progress) {
  try {
    if (!storage) return false;
    storage.setItem(SAVE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
