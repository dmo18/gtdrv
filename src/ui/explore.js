// The Garage, Garages and Adventures screens (docs/REVAMP.md 6.4 and 6.6),
// registered on the pause menu through menu.registerScreen. Bodies only:
// the menu draws the frame, the Back button and the title. All text goes
// through textContent / DOM APIs, never innerHTML. No money anywhere.
import { PAINT_COLORS, GARAGE_CARS_MAX } from '../world/garages.js';
import { specOf } from '../core/garage.js';
import { nextStep, stepsDone } from '../core/explore.js';

const STYLE_ID = 'rw-explore-style';
const CSS = `
.rw-ex { display: grid; gap: 8px; height: 100%; min-height: 0; padding-top: 2px; }
.rw-ex-garage { grid-template-columns: minmax(0, 45fr) minmax(0, 55fr); }
.rw-ex-cars { overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; min-height: 0;
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; align-content: start; padding: 2px; }
.rw-ex-card { min-height: 56px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start;
  gap: 2px; padding: 4px 8px; text-align: left; border-radius: 10px; }
.rw-ex-card[aria-pressed="true"] { box-shadow: inset 0 0 0 2px var(--rw-accent); background: rgba(226,115,58,0.22); }
.rw-ex-card b { font-size: 14px; display: flex; gap: 6px; align-items: center; width: 100%; }
.rw-ex-card small { font-size: 11px; color: var(--rw-dim); font-weight: 500; }
.rw-ex-sw { width: 14px; height: 14px; border-radius: 4px; flex: 0 0 14px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.4); }
.rw-ex-tag { font-size: 10px; padding: 1px 5px; border-radius: 6px; background: #ffd08a; color: #1b120d; font-weight: 700; }
.rw-ex-side { display: flex; flex-direction: column; gap: 6px; min-height: 0; overflow: hidden; }
.rw-ex-name { font-size: 18px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 8px; min-height: 28px; }
.rw-ex-acts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.rw-ex-acts .rw-menu-btn { padding: 0 6px; }
.rw-ex-side .rw-menu-confirmrow { min-height: 52px; padding: 2px 0; }
.rw-ex-word { font-size: 13px; color: var(--rw-dim); margin: 0; }
.rw-ex-grid { display: grid; grid-template-columns: repeat(auto-fill, 48px); gap: 6px; }
.rw-ex-swatch { width: 48px; height: 48px; min-height: 48px; padding: 0; border-radius: 10px; }
.rw-ex-swatch[aria-checked="true"] { box-shadow: 0 0 0 3px #ffd9a8; }
.rw-ex-head { display: flex; align-items: center; gap: 8px; }
.rw-ex-head .rw-menu-btn { flex: 0 0 auto; }
.rw-ex-garages { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: minmax(52px, auto); align-content: start; }
.rw-ex-g { min-height: 52px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; text-align: left; gap: 1px; padding: 2px 10px; }
.rw-ex-g b { font-size: 14px; }
.rw-ex-g small { font-size: 11px; color: var(--rw-dim); font-weight: 500; }
.rw-ex-g:disabled { opacity: 0.6; }
.rw-ex-adv { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
.rw-ex-col { display: flex; flex-direction: column; min-height: 0; }
.rw-ex-col h3 { margin: 0 0 4px; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--rw-accent); }
.rw-ex-list { overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.rw-ex-row { display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 4px 8px; border-radius: 10px; background: rgba(246,239,230,0.07); }
.rw-ex-row > div { flex: 1 1 auto; min-width: 0; }
.rw-ex-row b { display: block; font-size: 14px; }
.rw-ex-row small { display: block; font-size: 12px; color: var(--rw-dim); }
.rw-ex-row .rw-menu-btn { flex: 0 0 auto; min-width: 76px; }
.rw-ex-rumours { grid-column: 1 / -1; margin: 0; font-size: 13px; color: var(--rw-dim); }
.rw-ex-empty { font-size: 13px; color: var(--rw-dim); margin: 4px 0; }
`;

const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const labelOf = (spec) => { const s = specOf(spec); return s ? s.label : spec; };

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

// Registers the three screens; a no-op on a map without garages.
export function registerExploreScreens(game) {
  const menu = game.menu;
  if (!menu || !menu.registerScreen || !game.explore || !game.explore.active || !game.garages) return false;
  injectStyle();
  let sel = null; // 'arrived' or a car index
  let painting = false;
  let lastGarage = null;

  // ---------- Garage (at a garage in the world) ----------
  function renderGarage(body, api) {
    const { h, button } = api;
    const G = game.garages;
    const ex = game.explore.state;
    const g = G.current;
    if (!g) {
      body.appendChild(h('p', 'rw-menu-dim', 'Drive or walk up to a garage door to use it.'));
      return;
    }
    if (lastGarage !== g) { lastGarage = g; sel = null; painting = false; }
    const arrived = G.arrived();
    const cars = ex.garages.cars;
    if (sel === 'arrived' && !arrived) sel = null;
    if (typeof sel === 'number' && sel >= cars.length) sel = null;
    if (sel === null) sel = arrived ? 'arrived' : cars.length ? 0 : null;

    const wrap = h('div', 'rw-ex rw-ex-garage');
    wrap.dataset.role = 'garage-screen';
    // Left: the cards, two across, scrolls.
    const list = h('div', 'rw-ex-cars');
    list.dataset.role = 'garage-cars';
    const card = (key, spec, color, fav, reward, note) => {
      const b = button('', 'rw-ex-card', () => { sel = key; painting = false; api.rerender(); }, labelOf(spec) + (note ? ', ' + note : ''));
      b.setAttribute('aria-pressed', String(sel === key));
      b.dataset.car = String(key);
      const t = h('b');
      const sw = h('span', 'rw-ex-sw');
      sw.style.background = hex(color);
      t.append(sw, h('span', '', labelOf(spec)));
      if (fav) t.appendChild(h('span', '', '★'));
      b.appendChild(t);
      const sub = h('small');
      sub.textContent = note || '';
      if (reward) { const tag = h('span', 'rw-ex-tag', 'Reward'); sub.prepend(tag); }
      b.appendChild(sub);
      list.appendChild(b);
    };
    if (arrived) card('arrived', arrived.spec.id, arrived.color, arrived.fav === true, false, 'Driven in');
    cars.forEach((c, i) => card(i, c.spec, c.color, c.fav, c.reward, c.reward ? (G.isOut(c.spec) ? 'Out on the road' : '') : 'Stored'));
    if (!arrived && !cars.length) list.appendChild(h('p', 'rw-ex-empty', 'No cars here yet. Drive a car in and tap Store.'));
    wrap.appendChild(list);

    // Right: the selected car and its actions, or the swatch grid.
    const side = h('div', 'rw-ex-side');
    const isArr = sel === 'arrived';
    const car = isArr ? (arrived ? { spec: arrived.spec.id, color: arrived.color, fav: arrived.fav === true, reward: false } : null) : cars[sel];
    if (car && painting) {
      const head = h('div', 'rw-ex-head');
      const bk = button('Back', '', () => { painting = false; api.rerender(); }, 'Back to the car');
      bk.dataset.role = 'paint-back';
      head.append(bk, h('p', 'rw-ex-name', 'Repaint ' + labelOf(car.spec)));
      side.appendChild(head);
      const grid = h('div', 'rw-ex-grid');
      grid.setAttribute('role', 'radiogroup');
      grid.setAttribute('aria-label', 'Paint colours');
      const spec = specOf(car.spec);
      const colors = PAINT_COLORS.slice();
      for (const c of (spec && spec.colors) || []) if (!colors.includes(c)) colors.push(c);
      for (const c of colors) {
        const sw = button('', 'rw-ex-swatch', () => {
          G.repaint(isArr ? 'arrived' : sel, c);
          api.rerender();
        }, 'Colour ' + hex(c));
        sw.style.background = hex(c);
        sw.setAttribute('role', 'radio');
        sw.setAttribute('aria-checked', String(car.color === c));
        sw.dataset.color = hex(c);
        grid.appendChild(sw);
      }
      side.appendChild(grid);
    } else if (car) {
      const name = h('p', 'rw-ex-name', labelOf(car.spec));
      const sw = h('span', 'rw-ex-sw');
      sw.style.background = hex(car.color);
      name.prepend(sw);
      if (car.reward) name.appendChild(h('span', 'rw-ex-tag', 'Reward'));
      side.appendChild(name);
      const acts = h('div', 'rw-ex-acts');
      if (isArr) {
        const full = cars.length >= GARAGE_CARS_MAX;
        const st = button('Store', 'rw-menu-primary', () => { G.store(); sel = null; api.rerender(); }, 'Store this car');
        st.dataset.role = 'store';
        if (full) st.disabled = true;
        acts.appendChild(st);
      } else {
        const tk = button('Take out', 'rw-menu-primary', () => {
          const r = G.takeOut(sel);
          if (r.ok) { sel = null; api.close(); } else api.rerender();
        }, 'Take out the ' + labelOf(car.spec));
        tk.dataset.role = 'takeout';
        if (car.reward && G.isOut(car.spec)) {
          tk.disabled = true;
          tk.textContent = 'Out on the road';
        }
        acts.appendChild(tk);
      }
      const rp = button('Repaint', '', () => { painting = true; api.rerender(); }, 'Repaint');
      rp.dataset.role = 'repaint';
      acts.appendChild(rp);
      const fv = button(car.fav ? '★ Favourite' : '☆ Favourite', '', () => { G.favourite(sel); api.rerender(); }, car.fav ? 'Favourite: on' : 'Make favourite');
      fv.dataset.role = 'favourite';
      fv.setAttribute('aria-pressed', String(!!car.fav));
      if (isArr) fv.disabled = true;
      acts.appendChild(fv);
      side.appendChild(acts);
      if (!isArr && !car.reward) {
        const name2 = labelOf(car.spec);
        side.appendChild(api.confirmRow('Release', 'Yes, release the ' + name2, () => {
          G.release(sel);
          sel = null;
          api.rerender();
        }, { id: 'release-' + sel, role: 'release', text: 'Release from the collection' }));
      } else if (isArr && cars.length >= GARAGE_CARS_MAX) {
        side.appendChild(h('p', 'rw-ex-word', 'The collection is full (' + GARAGE_CARS_MAX + '). Release a car first.'));
      }
    } else {
      side.appendChild(h('p', 'rw-ex-name', g.name));
    }
    if (!painting) {
      const w = h('p', 'rw-ex-word', G.word ? G.word.text : '');
      w.dataset.role = 'garage-word';
      side.appendChild(w);
    }
    wrap.appendChild(side);
    body.appendChild(wrap);
  }

  // ---------- Garages (hub tile) ----------
  function renderGarages(body, api) {
    const { h, button } = api;
    const ex = game.explore.state;
    const wrap = h('div', 'rw-ex rw-ex-garages');
    wrap.dataset.role = 'garages-list';
    for (const g of game.explore.garages) {
      const found = ex.garages.found.includes(g.id);
      const b = button('', 'rw-ex-g', () => {
        game.waypoint = { x: g.door.x, z: g.door.z };
        api.close();
        if (game.input && game.input.press) { game.input.press('map'); game.input.release('map'); }
      }, found ? g.name + ', ' + g.place + '. Show on map' : 'Unknown garage');
      b.dataset.garage = g.id;
      b.append(h('b', '', found ? g.name : 'Unknown'), h('small', '', found ? g.place + '. Show on map' : (ex.garages.seen.includes(g.id) ? 'Seen on the map' : 'Not found yet')));
      if (!found) b.disabled = true;
      wrap.appendChild(b);
    }
    body.appendChild(wrap);
  }

  // ---------- Adventures (hub tile) ----------
  function rewardLine(a) {
    const r = a.reward;
    const parts = [r.score.toLocaleString('en-US') + ' pts'];
    if (r.garage) { const g = game.explore.garages.find((q) => q.id === r.garage); parts.push(g ? g.name : 'a garage'); }
    if (r.car) parts.push('the ' + labelOf(r.car));
    if (r.route) parts.push('a new route');
    return parts.join(', ');
  }
  function renderAdventures(body, api) {
    const { h, button } = api;
    const ex = game.explore.state;
    const A = ex.adventures;
    const wrap = h('div', 'rw-ex rw-ex-adv');
    const rum = h('p', 'rw-ex-rumours', 'Rumours to hear: ' + (game.explore.adventures.length - A.seen.length));
    rum.dataset.role = 'rumours';
    wrap.appendChild(rum);
    const col = (title, role) => {
      const c = h('div', 'rw-ex-col');
      c.appendChild(h('h3', '', title));
      const l = h('div', 'rw-ex-list');
      l.dataset.role = role;
      c.appendChild(l);
      wrap.appendChild(c);
      return l;
    };
    const active = col('Active', 'adv-active');
    const done = col('Done', 'adv-done');
    for (const a of game.explore.adventures) {
      if (!A.seen.includes(a.id) || A.done.includes(a.id)) continue;
      const row = h('div', 'rw-ex-row');
      const info = h('div');
      const k = nextStep(ex, a);
      const locked = a.needs.some((n) => !A.done.includes(n));
      const clue = locked ? 'Finish ' + a.needs.map((n) => (game.explore.adventures.find((q) => q.id === n) || { name: n }).name).join(', ') + ' first.'
        : k >= 0 ? a.steps[k].clue : '';
      const n = stepsDone(ex, a);
      info.append(h('b', '', a.name + (a.steps.length > 1 ? '  ' + n + ' / ' + a.steps.length : '')), h('small', '', clue));
      row.appendChild(info);
      const tracked = A.tracked === a.id;
      const tb = button(tracked ? 'Tracking' : 'Track', tracked ? 'rw-menu-primary' : '', () => {
        if (game.adventures) game.adventures.track(tracked ? null : a.id);
        api.rerender();
      }, (tracked ? 'Stop tracking ' : 'Track ') + a.name);
      tb.dataset.role = 'track';
      tb.dataset.adventure = a.id;
      if (locked) tb.disabled = true;
      row.appendChild(tb);
      active.appendChild(row);
    }
    if (!active.childNodes.length) active.appendChild(h('p', 'rw-ex-empty', 'Explore to hear rumours: signs, people and garages.'));
    for (const a of game.explore.adventures) {
      if (!A.done.includes(a.id)) continue;
      const row = h('div', 'rw-ex-row');
      const info = h('div');
      info.append(h('b', '', a.name), h('small', '', rewardLine(a)));
      row.appendChild(info);
      done.appendChild(row);
    }
    if (!done.childNodes.length) done.appendChild(h('p', 'rw-ex-empty', 'None yet.'));
    body.appendChild(wrap);
  }

  menu.registerScreen({ id: 'garage', title: 'Garage', render: (body, api) => {
    // The title shows the garage's name.
    renderGarage(body, api);
  } });
  menu.registerScreen({ id: 'garages', title: 'Garages', render: renderGarages });
  menu.registerScreen({ id: 'adventures', title: 'Adventures', render: renderAdventures });
  return true;
}
