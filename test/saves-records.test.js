import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { defaultLoop, recordTry, recordEvent, MAX_EVENTS } from '../src/core/records.js';
import { sanitizeLoop, defaultProgress, loadProgress, SAVE_KEY } from '../src/core/save.js';
import { buildSession } from '../src/core/garage.js';
import { travelSave, arrivalApprox } from '../src/core/travel.js';
import { MAP_CHOICE_KEY } from '../src/world/maps.js';
import { steerHint, carHints } from '../src/systems/tutorial.js';
import { setShown } from '../src/ui/combathud.js';

// ---- records
test('five failures then one completion: n=6, best medal and value kept', () => {
  const L = defaultLoop();
  const ev = { id: 'ev_beach_miss_1', tpl: 'miss' };
  for (let i = 0; i < 5; i++) recordTry(L, ev);
  assert.deepEqual(L.events[ev.id], { m: '', b: NaN, n: 5 });
  recordEvent(L, ev, 12, 'silver');
  assert.equal(L.events[ev.id].n, 6);
  assert.equal(L.events[ev.id].m, 'silver');
  assert.equal(L.events[ev.id].b, 12);
  const back = sanitizeLoop(JSON.parse(JSON.stringify(L)));
  assert.equal(back.events[ev.id].n, 6);
  assert.equal(back.events[ev.id].m, 'silver');
});
test('a failed first try is accepted by saved-data validation; the event limit holds', () => {
  const L = defaultLoop();
  recordTry(L, { id: 'ev_beach_heat_2', tpl: 'heat' });
  const back = sanitizeLoop(JSON.parse(JSON.stringify(L)));
  assert.equal(back.events.ev_beach_heat_2.n, 1);
  assert.equal(back.events.ev_beach_heat_2.m, '');
  for (let i = 0; Object.keys(L.events).length < MAX_EVENTS; i++) L.events['ev_beach_miss_' + i] = { m: '', b: NaN, n: 1 };
  recordTry(L, { id: 'ev_south_dash_7', tpl: 'dash' });
  assert.equal(L.events.ev_south_dash_7, undefined);
});

// ---- travel save
const memory = () => {
  const m = new Map();
  const blocked = new Set();
  return {
    m, blocked,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { if (blocked.has(k)) throw new Error('quota'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
  };
};
const car = () => ({ kind: 'car', spec: { id: 'sedan', health: 100 }, color: 0x336699, health: 80, x: 10, z: 20, heading: 1, y: 0, speed: 12 });
const go = (st, p) => travelSave(st, p, 'miami-downtown', 'miami-south', car(), { mode: 'car' }, arrivalApprox('miami-south', 'downtown-south-brickell'));

for (const [name, keys] of [['progress write blocked', [SAVE_KEY]], ['map key blocked', [MAP_CHOICE_KEY]], ['all blocked', [SAVE_KEY, MAP_CHOICE_KEY]]]) {
  test('travelSave: ' + name + ' restores everything; one departure after recovery', () => {
    const st = memory();
    const p = defaultProgress();
    p.session = buildSession(null, car(), [], 'miami-downtown');
    st.setItem(MAP_CHOICE_KEY, 'miami-downtown');
    const before = { save: st.getItem(SAVE_KEY), map: st.getItem(MAP_CHOICE_KEY), session: JSON.stringify(p.session) };
    for (const k of keys) st.blocked.add(k);
    assert.equal(go(st, p), false);
    assert.equal(st.getItem(SAVE_KEY), before.save);
    assert.equal(st.getItem(MAP_CHOICE_KEY), before.map);
    assert.equal(JSON.stringify(p.session), before.session);
    assert.equal(p.session.map, 'miami-downtown');
    assert.equal(p.session.mode, 'car');
    st.blocked.clear();
    assert.equal(go(st, p), true);
    assert.equal(st.getItem(MAP_CHOICE_KEY), 'miami-south');
    assert.equal(loadProgress(st).session.map, 'miami-south');
  });
}

test('session.travelTo calls travelSave first and only reloads after it succeeded', () => {
  const src = readFileSync(new URL('../src/systems/session.js', import.meta.url), 'utf8');
  const i = src.indexOf('if (!travelSave(');
  const j = src.indexOf('held = true;');
  const k = src.indexOf('setTimeout(go, 120)');
  assert.ok(i > 0 && i < j && j < k, 'the save check comes before hold, note and reload');
  assert.match(src.slice(i, j), /return TRAVEL_SAVE_FAILED/);
});

// ---- service worker
function loadSw(files, { missing = new Set(), caches0 = {} } = {}) {
  const store = { ...caches0 };
  const listeners = {};
  class Request { constructor(url) { this.url = url; } }
  const fetchFn = async (r) => ({ ok: !missing.has(r.url), url: r.url });
  const mkCache = (name) => ({
    async addAll(reqs) {
      const got = [];
      for (const r of reqs) {
        const res = await fetchFn(r);
        if (!res.ok) throw new Error('404 ' + r.url);
        got.push(r.url);
      }
      store[name].push(...got);
    },
    async put(r) { store[name].push(r.url); },
  });
  const caches = {
    async open(n) { if (!store[n]) store[n] = []; return mkCache(n); },
    async delete(n) { return delete store[n]; },
    async keys() { return Object.keys(store); },
  };
  const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    .replace("'__VERSION__'", "'abc'").replace('const FILES = __FILES__;', 'const FILES = ' + JSON.stringify(files) + ';');
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, location: { origin: 'x' }, registration: { scope: 'x/' }, clients: { claim() {} } };
  vm.runInNewContext(src, { self, caches, fetch: fetchFn, Request, URL, Promise });
  const install = () => { let p; listeners.install({ waitUntil: (x) => { p = x; } }); return p; };
  return { store, install };
}
const FILES = ['./', 'index.html', 'game.js', 'manifest.webmanifest', 'icons/a.png', 'icon.svg'];
test('sw: a missing optional icon still installs the play files', async () => {
  const sw = loadSw(FILES, { missing: new Set(['icons/a.png']) });
  await sw.install();
  const c = sw.store['rustwater-abc'];
  for (const f of ['./', 'index.html', 'game.js', 'manifest.webmanifest', 'icon.svg']) assert.ok(c.includes(f), f);
  assert.ok(!c.includes('icons/a.png'));
});
test('sw: a missing required file fails the install and keeps the old cache', async () => {
  const sw = loadSw(FILES, { missing: new Set(['game.js']), caches0: { 'rustwater-old': ['index.html'] } });
  await assert.rejects(sw.install());
  assert.equal(sw.store['rustwater-abc'], undefined);
  assert.deepEqual(sw.store['rustwater-old'], ['index.html']);
});

// ---- tutorial hints
test('car steering hint follows steering and handedness', () => {
  for (const hand of [false, true]) {
    const side = hand ? 'right' : 'left';
    assert.equal(steerHint({ steering: 'wheel', leftHanded: hand }), 'Steer with the wheel on the ' + side + '.');
    assert.equal(steerHint({ steering: 'buttons', leftHanded: hand }), 'Tap the arrow pads on the ' + side + ' to steer.');
    assert.equal(steerHint({ steering: 'tilt', leftHanded: hand }), 'Tilt your phone to steer.');
    assert.equal(steerHint({ steering: 'slider', leftHanded: hand }), 'Slide your thumb on the ' + side + ' to steer.');
  }
  assert.match(steerHint(undefined), /wheel on the left/);
  assert.ok(!carHints({ steering: 'tilt' }).some((l) => /wheel/i.test(l)));
});
test('hints name BOOST and the top left map', () => {
  const src = readFileSync(new URL('../src/systems/tutorial.js', import.meta.url), 'utf8');
  assert.ok(src.includes('hold BOOST for afterburner'));
  assert.ok(src.includes('(top left)') && !src.includes('(top right)'));
});

// ---- combat hud toggle
test('setShown keeps hidden and aria-hidden together and tolerates null', () => {
  const attrs = {};
  const el = { hidden: false, setAttribute: (k, v) => { attrs[k] = v; } };
  setShown(el, false);
  assert.equal(el.hidden, true);
  assert.equal(attrs['aria-hidden'], 'true');
  setShown(el, true);
  assert.equal(el.hidden, false);
  assert.equal(attrs['aria-hidden'], 'false');
  setShown(null, true);
});
