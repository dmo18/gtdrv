// The map picker (docs/PLAN_V2.md 3.1 and 5.3 R3): the five Miami regions
// and the classic island as big cards, one tap each. A tap stores the
// choice (localStorage `rustwater.map`), covers the screen with a loading
// veil and reloads, because the region's data loads with the page. Used by
// the title screen and the pause menu. All text goes through textContent;
// nothing is fetched; no wall-clock time reaches the game logic.
import { MAP_CHOICE_KEY } from '../world/maps.js';
import { PICKER, mapName, pickerCurrent, ISLAND } from '../core/travel.js';

const SUB = {
  'miami-downtown': 'The start: towers, the bay and the airfield',
  'miami-beach': 'The causeways, the beach and the keys',
  'miami-north': 'Wynwood, warehouses and the north roads',
  'miami-west': 'Little Havana, the river and the civic centre',
  'miami-south': 'The long roads and the south shore',
  [ISLAND]: 'The original island, no garages or adventures',
};

const CSS = `
.rw-mp-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0; padding: 0; }
.rw-mp-card { box-sizing: border-box; min-height: 60px; padding: 6px 12px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 2px;
  text-align: left; font: inherit; color: #f6efe6; background: rgba(0,0,0,0.55); border: 2px solid rgba(246,239,230,0.3); border-radius: 12px; cursor: pointer; touch-action: manipulation; }
.rw-mp-card b { font-size: 16px; line-height: 20px; }
.rw-mp-card span { font-size: 12px; line-height: 15px; opacity: 0.8; }
.rw-mp-card[data-current="true"] { border-color: #e2733a; background: rgba(226,115,58,0.28); }
.rw-mp-card:focus-visible { outline: 3px solid #ffd08a; outline-offset: 2px; }
.rw-mp-veil { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; background: #14110f; color: #f6efe6; font-size: 20px; font-weight: 700; text-align: center; padding: 24px; }
`;

function injectCss(doc) {
  if (!doc || !doc.head || doc.getElementById('rw-mappicker-style')) return;
  const st = doc.createElement('style');
  st.id = 'rw-mappicker-style';
  st.textContent = CSS;
  doc.head.appendChild(st);
}

// A full-screen veil with one line of text; returns { remove }.
export function showVeil(doc, text) {
  injectCss(doc);
  const el = doc.createElement('div');
  el.className = 'rw-mp-veil';
  el.setAttribute('role', 'status');
  el.dataset.role = 'map-veil';
  el.textContent = text;
  (doc.body || doc.documentElement).appendChild(el);
  return { el, remove() { el.remove(); } };
}

// Store the choice, show the veil, reload. `reload` and `storage` can be
// replaced by tests. Returns true when the choice was stored.
export function switchMap(doc, id, opts = {}) {
  if (!PICKER.some((p) => p.id === id)) return false;
  let stored = true;
  try {
    (opts.storage || localStorage).setItem(MAP_CHOICE_KEY, id);
  } catch {
    stored = false; // storage blocked: the choice lasts this visit only
  }
  if (opts.before) opts.before();
  showVeil(doc, 'Loading ' + mapName(id) + '...');
  const reload = opts.reload || (() => { if (typeof location !== 'undefined' && location.reload) location.reload(); });
  setTimeout(reload, 80);
  return stored;
}

// Fills `parent` with one card per map. current: the id playing now.
// regionsOnly leaves the classic island out (the Travel list); hint
// replaces each card's sub line (for example "Tap to travel").
// onPick(id) runs for a tap on a card that is not the current one.
export function fillMapPicker(doc, parent, { current, onPick, regionsOnly = false, hint = null }) {
  injectCss(doc);
  const cur = pickerCurrent(current);
  const list = doc.createElement('div');
  list.className = 'rw-mp-list';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Choose a map');
  list.dataset.role = 'map-picker';
  for (const m of PICKER) {
    if (regionsOnly && m.id === ISLAND) continue;
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'rw-mp-card';
    b.dataset.map = m.id;
    b.dataset.role = 'map-' + m.id;
    b.dataset.current = String(m.id === cur);
    const name = doc.createElement('b');
    name.textContent = m.name;
    const sub = doc.createElement('span');
    sub.textContent = m.id === cur ? 'You are here' : hint || SUB[m.id] || '';
    b.append(name, sub);
    b.setAttribute('aria-label', m.name + (m.id === cur ? ', you are here' : ''));
    b.addEventListener('click', () => { if (m.id !== cur && onPick) onPick(m.id); });
    list.appendChild(b);
  }
  parent.appendChild(list);
  return list;
}
