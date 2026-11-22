// Exploring Miami (docs/REVAMP.md 6.6): the explore cells, the sixteen
// adventures with their givers (signs, talkers, garages, the start), the
// steps and rewards, the map markers, and the explore save under its own
// storage key. Also owns game.explore, which the garages system, the menu
// screens (ui/explore.js), activities (locked routes) and Stats read.
//
// The rules are pure (core/explore.js, world/adventures.js, tested in
// test/adventures.test.js and test/explore.test.js). Meshes and the TALK
// button are made only when game.scene / game.touch exist. On the island
// (no city.adventures) everything here does nothing.
//
//   game.explore.state      the explore state (core/explore.js shape)
//   game.explore.counts()   { garagesFound, garagesTotal, adventuresDone, adventuresTotal, percent }
//   game.explore.isDone(id) an adventure is finished
//   game.explore.changed()  save now and tell the menu
//   game.adventures.track(id), .objective, .talk(), .probe(x, y, z, mode)
import {
  loadExplore, saveExplore, clearExplore, defaultExplore, counts as exploreCounts, cellIndex, cellBit, setCellBit,
  cellsFrom, bytesToB64, landCells, explorePercent, markAdventureSeen, markGarageSeen, adventureReady, nextStep,
  completeStep, track as trackAdventure, favourite as favouriteOf, routeOpen, garageOpen,
} from '../core/explore.js';
import { ADV_SEEN_R, ADV_SIGN_R, ADV_TALK_R, ADV_TALKERS_MAX, ADV_TALKER_NEAR, ADV_FINALE_BONUS, playerStepMode, stepReached } from '../world/adventures.js';
import { GARAGE_FIND_R } from '../world/garages.js';
import { createExploreMeshes } from '../render/exploremesh.js';
import { specOf } from '../core/garage.js';

const CHECK_EVERY = 0.2; // s between looks at the player's position
const CELL_POINTS = 50;
const CELL_SAVE_EVERY = 10; // s: new cells are written at most this often
const TALK_PROMPT_TIME = 5;
const COLORS = { garage: '#9aa0a6', garageFound: '#f2b84b', rumour: '#ffd34d', ring: '#ff8a3d', done: '#6fd06f' };

export function createAdventures(game, storage) {
  const city = game.city;
  const events = game.events;
  const advs = Array.isArray(city.adventures) ? city.adventures : [];
  const garages = Array.isArray(city.garages) ? city.garages : [];
  const on = advs.length > 0;
  const loaded = on ? loadExplore(storage) : { state: defaultExplore(), newer: false };
  let ex = loaded.state;
  // A save from a newer build is left alone: play on defaults, never write.
  const readOnly = loaded.newer;
  const land = on ? landCells((x, z) => city.isLand(x, z)) : new Uint8Array(0);
  let cells = cellsFrom(ex);
  let percent = on ? explorePercent(cells, land) : 0;
  let cellsDirty = false;
  let cellTimer = CELL_SAVE_EVERY;

  const toast = (text, s = 3) => { if (game.hud && game.hud.toast) game.hud.toast(text, s); };
  function award(points, reason, x, z) {
    if (game.score && game.score.add) game.score.add(points, reason, x, z, true);
  }
  // The 50 points for a new cell come without a toast.
  function quietAward(points, x, z) {
    const hud = game.hud;
    const t = hud ? hud.toast : null;
    if (hud) hud.toast = () => {};
    try {
      award(points, 'Explored', x, z);
    } finally {
      if (hud) hud.toast = t;
    }
  }

  function save() {
    if (!on || readOnly) return false;
    ex.cells = bytesToB64(cells);
    cellsDirty = false;
    cellTimer = CELL_SAVE_EVERY;
    return saveExplore(storage, ex);
  }
  function changed() {
    save();
    refreshMarkers();
    events.emit('progress');
  }

  const isDone = (id) => ex.adventures.done.includes(id);
  const explore = {
    get state() { return ex; },
    get readOnly() { return readOnly; },
    active: on,
    garages,
    adventures: advs,
    counts: () => exploreCounts(ex, percent),
    isDone,
    routeOpen: (advId) => routeOpen(ex, advId),
    garageOpen: (gid) => garageOpen(ex, gid),
    favourite: () => favouriteOf(ex),
    changed,
    save,
  };
  game.explore = explore;

  // ---- map markers (pre-made, added and removed on change) -----------------------
  const gMarks = garages.map((g) => ({ x: g.door.x, z: g.door.z, type: 'explore-garage', color: COLORS.garage, label: '', id: g.id }));
  const aMarks = advs.map((a) => ({ x: a.giver.x, z: a.giver.z, type: 'explore-rumour', color: COLORS.rumour, label: '?', id: a.id }));
  const ring = { x: 0, z: 0, r: 0, type: 'explore-ring', color: COLORS.ring, label: '', id: '' };
  const shown = new Set();
  const layerList = [];
  function setShown(m, want) {
    if (want === shown.has(m)) return;
    if (want) shown.add(m); else shown.delete(m);
    if (layer) return;
    const map = game.map;
    if (!map || !map.addMarker) return;
    if (want) map.addMarker(m); else map.removeMarker(m);
  }
  // W4's map layer when there is one; else the plain marker list.
  let layer = null;
  if (on && game.map && typeof game.map.addLayer === 'function') {
    layer = game.map.addLayer({
      id: 'explore',
      markers() {
        layerList.length = 0;
        for (const m of shown) layerList.push(m);
        return layerList;
      },
    }) || true;
  }
  let objective = null;
  const objGoal = { x: 0, z: 0, label: '' };
  function refreshMarkers() {
    if (!on) return;
    for (let i = 0; i < garages.length; i++) {
      const g = garages[i], m = gMarks[i];
      const seen = ex.garages.seen.includes(g.id) || (g.known && garageOpen(ex, g.id));
      const found = ex.garages.found.includes(g.id);
      m.color = found ? COLORS.garageFound : COLORS.garage;
      m.label = found ? g.name : '';
      setShown(m, seen);
    }
    for (let i = 0; i < advs.length; i++) {
      const a = advs[i], m = aMarks[i];
      const seen = ex.adventures.seen.includes(a.id);
      const done = isDone(a.id);
      m.color = done ? COLORS.done : COLORS.rumour;
      m.label = done ? a.name : '?';
      m.x = a.giver.x;
      m.z = a.giver.z;
      setShown(m, seen);
    }
    // The tracked adventure: a ring round its next step, off centre.
    objective = null;
    const t = ex.adventures.tracked ? advs.find((a) => a.id === ex.adventures.tracked) : null;
    const k = t ? nextStep(ex, t) : -1;
    if (t && k >= 0) {
      const s = t.steps[k];
      ring.x = s.rx;
      ring.z = s.rz;
      ring.r = s.hint;
      ring.label = t.name;
      ring.id = t.id;
      objGoal.x = s.rx;
      objGoal.z = s.rz;
      objGoal.label = t.name;
      objective = objGoal;
      setShown(ring, true);
    } else setShown(ring, false);
  }

  // ---- meshes (browser only) ----------------------------------------------------
  const meshes = on && game.scene ? createExploreMeshes(game.scene, { garages, adventures: advs }) : null;

  // ---- talkers: the two nearest within 200 m, hidden while wanted ---------------------
  const talkers = advs.filter((a) => a.giver.type === 'talker');
  const signs = advs.filter((a) => a.giver.type === 'sign');
  const readSigns = new Set(); // boards read on this visit
  const nearTalk = [];
  let talkTarget = null;
  let talkPrompt = 0;
  if (on && game.touch && game.touch.registerAction) {
    game.touch.registerAction({
      id: 'talk', label: 'Talk', text: 'TALK', group: 'primary', modes: ['foot'],
      icon: '<path d="M4 5h16v10H9l-4 4v-4H4z"/>',
      press: () => talk(),
      visible: () => !!talkTarget,
    });
  }
  function hear(a) {
    const fresh = markAdventureSeen(ex, a.id);
    if (fresh) events.emit('adventureSeen', { id: a.id });
    if (!ex.adventures.tracked && adventureReady(ex, a)) trackAdventure(ex, a.id);
    return fresh;
  }
  function talk() {
    const a = talkTarget;
    if (!a) return false;
    hear(a);
    if (game.hud && game.hud.setPrompt) game.hud.setPrompt(a.giver.line);
    talkPrompt = TALK_PROMPT_TIME;
    changed();
    return true;
  }
  function pickTalkers(p) {
    nearTalk.length = 0;
    if (p.wanted > 0 || (game.police && game.police.stars > 0)) return;
    for (let i = 0; i < talkers.length; i++) {
      const a = talkers[i];
      const d = Math.hypot(a.giver.x - p.x, a.giver.z - p.z);
      if (d > ADV_TALKER_NEAR || isDone(a.id)) continue;
      nearTalk.push(a);
    }
    nearTalk.sort((a, b) => Math.hypot(a.giver.x - p.x, a.giver.z - p.z) - Math.hypot(b.giver.x - p.x, b.giver.z - p.z));
    if (nearTalk.length > ADV_TALKERS_MAX) nearTalk.length = ADV_TALKERS_MAX;
  }

  // ---- steps ----------------------------------------------------------------------
  let stuntMedal = null, stuntT = -1, stuntX = 0, stuntZ = 0;
  events.on('stunt', (e) => {
    if (!e || !e.ok || !e.medal || !e.spot) return;
    stuntMedal = e.medal;
    stuntT = game.time || 0;
    stuntX = e.spot.x;
    stuntZ = e.spot.z;
  });
  const stuntNow = (s) => (stuntMedal && (game.time || 0) - stuntT < 2 && Math.hypot(stuntX - s.x, stuntZ - s.z) < 60 ? stuntMedal : null);

  function rewardText(a) {
    const r = a.reward;
    const parts = ['+' + r.score.toLocaleString('en-US')];
    if (r.garage) {
      const g = garages.find((q) => q.id === r.garage);
      parts.push('garage unlocked: ' + (g ? g.name : r.garage));
    }
    if (r.car) {
      const s = specOf(r.car);
      parts.push('new car in your garages: ' + (s ? s.label : r.car));
    }
    if (r.route) parts.push('new route unlocked');
    return parts.join(', ');
  }

  function finish(a, x, z) {
    award(a.reward.score, 'Adventure: ' + a.name, x, z);
    toast(a.name + ' done. ' + rewardText(a), 5);
    events.emit('adventureDone', { id: a.id });
    // A revealed garage goes on the map at once.
    if (a.reward.garage) markGarageSeen(ex, a.reward.garage);
    if (ex.adventures.done.length === advs.length) {
      award(ADV_FINALE_BONUS, 'All adventures', x, z);
      toast('Every adventure done. +' + ADV_FINALE_BONUS.toLocaleString('en-US'), 5);
    }
  }

  // Look for steps reached by a player at (x, y, z) in step mode `mode`.
  function checkSteps(x, y, z, mode) {
    let any = false;
    for (let i = 0; i < advs.length; i++) {
      const a = advs[i];
      if (!adventureReady(ex, a)) continue;
      const v = ex.adventures.step[a.id] || 0;
      for (let k = 0; k < a.steps.length; k++) {
        if (a.order === 'any' ? (v & (1 << k)) : k !== v) continue;
        const s = a.steps[k];
        if (!stepReached(s, x, y, z, mode, s.stunt ? stuntNow(s) : null)) continue;
        const res = completeStep(ex, a, k);
        if (!res) continue;
        any = true;
        events.emit('adventureStep', { id: a.id, step: k });
        if (res === 'done') finish(a, x, z);
        else {
          const nk = nextStep(ex, a);
          toast(a.name + ': ' + (nk >= 0 ? a.steps[nk].clue : 'step done'), 4.5);
          if (!ex.adventures.tracked) trackAdventure(ex, a.id);
        }
        break;
      }
    }
    if (any) changed();
    return any;
  }

  // Rumours, signs and garages seen from where the player is.
  function lookAround(x, z) {
    let any = false;
    for (let i = 0; i < garages.length; i++) {
      const g = garages[i];
      if (ex.garages.seen.includes(g.id) || !garageOpen(ex, g.id)) continue;
      if (Math.hypot(g.door.x - x, g.door.z - z) < GARAGE_FIND_R) any = markGarageSeen(ex, g.id) || any;
    }
    for (let i = 0; i < advs.length; i++) {
      const a = advs[i];
      if (ex.adventures.seen.includes(a.id)) continue;
      if (Math.hypot(a.giver.x - x, a.giver.z - z) < ADV_SEEN_R) {
        any = hear(a) || any;
        toast('Rumour: ' + a.name + '. A "?" is on your map.', 3);
      }
    }
    // Reading a notice board: its line, once per visit.
    for (let i = 0; i < signs.length; i++) {
      const a = signs[i];
      const near = Math.hypot(a.giver.x - x, a.giver.z - z) < ADV_SIGN_R;
      if (near && !readSigns.has(a.id)) {
        readSigns.add(a.id);
        hear(a);
        toast(a.giver.line, 5);
        any = true;
      } else if (!near && readSigns.has(a.id) && Math.hypot(a.giver.x - x, a.giver.z - z) > ADV_SIGN_R * 4) readSigns.delete(a.id);
    }
    if (any) changed();
  }

  function newCell(x, z) {
    const c = cellIndex(x, z);
    if (c < 0 || !land[c] || cellBit(cells, c)) return false;
    setCellBit(cells, c);
    percent = explorePercent(cells, land);
    cellsDirty = true;
    quietAward(CELL_POINTS, x, z);
    events.emit('explored', { cell: c, percent });
    return true;
  }

  // ---- start-up: the start rumour is known from the first launch -----------------------
  if (on) {
    for (const a of advs) if (a.giver.type === 'start') hear(a);
    if (!readOnly) save();
  }

  events.on('pause', (p) => { if (p && cellsDirty) save(); });
  events.on('progressReset', () => {
    // "Erase all progress" clears this key too.
    clearExplore(storage);
    ex = defaultExplore();
    cells = cellsFrom(ex);
    percent = 0;
    for (const a of advs) if (a.giver.type === 'start') markAdventureSeen(ex, a.id);
    readSigns.clear();
    if (!readOnly) save();
    refreshMarkers();
  });
  if (on && typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  }
  if (on && typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pagehide', save);

  let timer = 0;
  let marked = false;
  const api = {
    name: 'adventures',
    list: advs,
    meshes,
    get objective() { return objective; },
    get talkers() { return nearTalk; },
    get talkTarget() { return talkTarget; },
    talk,
    track(id) {
      if (!trackAdventure(ex, id)) return false;
      changed();
      return true;
    },
    // Test hook: pretend the player is at (x, y, z) in a step mode.
    probe(x, y, z, mode = 'foot') {
      lookAround(x, z);
      newCell(x, z);
      return checkSteps(x, y, z, mode);
    },
    fixedUpdate(dt) {
      if (!on) return;
      if (!marked) {
        marked = true;
        refreshMarkers();
      }
      const p = game.player;
      if (talkPrompt > 0) {
        talkPrompt -= dt;
        if (talkPrompt <= 0 && game.hud && game.hud.setPrompt) game.hud.setPrompt(null);
      }
      timer -= dt;
      if (timer <= 0) {
        timer = CHECK_EVERY;
        lookAround(p.x, p.z);
        newCell(p.x, p.z);
        checkSteps(p.x, p.y || 0, p.z, playerStepMode(p.mode));
        pickTalkers(p);
        let t = null;
        if (p.mode === 'foot') {
          for (let i = 0; i < nearTalk.length; i++) {
            const a = nearTalk[i];
            if (Math.hypot(a.giver.x - p.x, a.giver.z - p.z) <= ADV_TALK_R) { t = a; break; }
          }
        }
        talkTarget = t;
      }
      if (cellsDirty) {
        cellTimer -= dt;
        if (cellTimer <= 0) save();
      }
    },
    render(_alpha, dt) {
      if (meshes) meshes.update(dt, nearTalk, game.time || 0);
    },
  };
  return api;
}
