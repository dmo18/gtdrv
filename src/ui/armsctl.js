// Every armed-craft control and the DETONATE button, registered through
// touch.registerAction (docs/UI.md "Adding a control", docs/ARMS.md
// "Touch in armed aircraft" and section 3). Called once by the combat HUD.
//
// Layout (styles.js arc slots, mirrored for left-handed):
//   plane / heli: GUN (big, hold = slot 0), MSL (hold = slot 1, ring fills
//     while seeking, solid when locked), BOMB (tap, count pip), LOCK (tap =
//     cycle the seeker) in an arc above the pedals. Only the buttons for the
//     craft's mounts appear (spec.mounts). SIREN (police craft) and VIEW
//     sit in the "more" fan.
//   tank: CANNON (big, slot 0), COAX (hold, slot 1), LOCK; EXIT and VIEW
//     come from touch.js. Task 32 adds the turret logic in combat's
//     CRAFT_HOOKS.tank; nothing here needs to change.
//   every mode: DETONATE (pulsing) while the player owns placed charges.
//
// Readouts (update(), once per frame, DOM writes only on change): the
// magazine pip on each button, the reload ring, the seeker ring.
import { MOUNTS, createCraftArms, mountFor, mountReload } from '../core/weapons.js';

// id -> [label, icon, text, input, slot, modes, what it needs]
export const ARMS_ACTIONS = {
  gun: ['Fire guns', 'gun', 'GUN', 'fire', 'gun', ['plane', 'heli'], 0],
  msl: ['Fire missile (hold)', 'missile', 'MSL', 'fire2', 'msl', ['plane', 'heli'], 1],
  bomb: ['Drop a bomb', 'bomb', 'BOMB', 'drop', 'bomb', ['plane', 'heli'], 'drop'],
  alock: ['Lock on (tap to cycle)', 'lock', 'LOCK', 'lock', 'alock', ['plane', 'heli'], 'lock'],
  cannon: ['Fire cannon', 'cannon', 'CANNON', 'fire', 'cannon', ['tank'], 0],
  coax: ['Fire coaxial gun', 'gun', 'COAX', 'fire2', 'coax', ['tank'], 1],
  tlock: ['Lock on', 'lock', 'LOCK', 'lock', 'tlock', ['tank'], 'lock'],
};

export function registerArmsControls(game, touch) {
  if (!touch || typeof touch.registerAction !== 'function') return null;
  const craft = () => {
    const p = game.player;
    return p && p.vehicle && p.vehicle.spec ? p.vehicle : null;
  };
  const armsOf = (v) => {
    if (!v) return null;
    if (game.combat && game.combat.armsOf) return game.combat.armsOf(v);
    if (v.arms === undefined) v.arms = createCraftArms(v.spec);
    return v.arms || null;
  };
  // Mount id behind a slot of the current craft, or null.
  const mountOf = (need) => {
    const a = armsOf(craft());
    if (!a) return null;
    if (need === 'lock') {
      // LOCK only matters with a homing weapon aboard (or a tank).
      const v = craft();
      if (v.kind === 'tank') return mountFor(a, 0);
      for (let i = 0; i < a.ids.length; i++) if (MOUNTS[a.ids[i]].type === 'missile') return a.ids[i];
      return null;
    }
    return mountFor(a, need);
  };
  const handles = {};
  const view = {};
  for (const id of Object.keys(ARMS_ACTIONS)) {
    const [label, icon, text, input, slot, modes, need] = ARMS_ACTIONS[id];
    const h = touch.registerAction({
      id, label, icon, text, group: 'primary', slot, modes, input,
      visible: () => !!mountOf(need),
    });
    const face = h.el.querySelector('.rw-face');
    let pip = null;
    if (face && need !== 'lock' && typeof document !== 'undefined') {
      pip = document.createElement('b');
      pip.className = 'rw-pip';
      face.appendChild(pip);
    }
    handles[id] = h;
    view[id] = { el: h.el, face, pip, n: -2, ring: -1, lock: null, need, cap: h.el.querySelector('.rw-face span'), text: '' };
  }
  const walker = () => game.player && game.player.walker;
  handles.detonate = touch.registerAction({
    id: 'detonate', label: 'Detonate charges', icon: 'detonate', text: 'BOOM', group: 'primary',
    input: 'detonate', slot: 'det',
    visible: () => !!(game.combat && game.combat.countStickies && game.combat.countStickies(walker()) > 0),
  });
  handles.siren = touch.registerAction({
    id: 'siren', label: 'Siren and lights', icon: 'siren', text: 'SIREN', group: 'secondary',
    modes: ['heli', 'plane', 'tank'], input: 'horn',
    visible: () => {
      const v = craft();
      return !!(v && v.spec.police);
    },
  });

  // Captions and rings, called once per frame.
  function update() {
    const v = craft();
    const a = armsOf(v);
    const sk = game.combat && game.combat.seeker;
    for (const id in view) {
      const s = view[id];
      const mid = a ? (s.need === 'lock' ? null : mountFor(a, s.need)) : null;
      const n = mid ? a.mag[mid] : -1;
      if (n !== s.n && s.pip) {
        s.n = n;
        s.pip.textContent = n >= 0 ? String(n) : '';
      }
      // Ring: reload progress, else (MSL and LOCK) the seeker filling up.
      let ring = mid ? mountReload(a, mid) : 0;
      const seekBtn = (id === 'msl' && mid && MOUNTS[mid].type === 'missile') || id === 'alock';
      let locked = false;
      if (!(ring > 0) && seekBtn && sk && sk.target) {
        ring = sk.progress;
        locked = sk.state === 'locked';
      }
      ring = Math.round(ring * 40) / 40;
      if (ring !== s.ring) {
        s.ring = ring;
        if (s.face) s.face.style.setProperty('--ring', String(ring));
        s.el.classList.toggle('rw-ringon', ring > 0);
      }
      if (locked !== s.lock) {
        s.lock = locked;
        s.el.classList.toggle('rw-on', locked);
      }
      // Slot 1 caption follows the mount (MSL for missiles).
      if (id === 'msl' && s.cap && mid) {
        const t = MOUNTS[mid].type === 'missile' ? 'MSL' : 'GUN 2';
        if (t !== s.text) {
          s.text = t;
          s.cap.textContent = t;
        }
      }
    }
  }
  return {
    handles,
    update,
    remove() {
      for (const k in handles) handles[k].remove();
    },
  };
}
