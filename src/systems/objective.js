import { formatDistance } from '../core/units.js';
// Objective arrow: while a race or delivery is running (or a map waypoint is
// set) a big arrow on screen points to where to go, with the distance.
// Pure helper first, then a small DOM overlay guarded for node tests.

// Degrees to turn an "up" arrow so it points at the target as seen from a
// camera facing `camHeading`. Heading 0 faces +x and increases toward +z,
// which is clockwise from above, so a positive angle is to the right.
export function objectiveAngle(px, pz, camHeading, tx, tz) {
  const bearing = Math.atan2(tz - pz, tx - px);
  let d = bearing - camHeading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return (d * 180) / Math.PI;
}

const CSS = `
.rw-obj { position: absolute; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 22px); z-index: 21; pointer-events: none;
  transform: translateX(-50%); text-align: center; font-family: system-ui, sans-serif; font-weight: 800; color: #ffe9a8;
  text-shadow: 0 1px 4px rgba(0,0,0,0.85); }
.rw-obj.rw-obj-off { display: none; }
.rw-obj svg { width: 54px; height: 54px; display: block; margin: 0 auto; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.7)); }
.rw-obj small { display: block; font-size: 12px; letter-spacing: 0.06em; }
`;

export function createObjective(game, uiRoot) {
  let el = null, arrow = null, label = null;
  let shownAngle = 1e9, shownDist = -1, shownOn = true;
  if (typeof document !== 'undefined' && uiRoot) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    el = document.createElement('div');
    el.className = 'rw-obj rw-obj-off';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<svg viewBox="0 0 48 48"><path d="M24 3 L42 40 L24 31 L6 40 Z" fill="#ffd34d" stroke="#1a120d" stroke-width="3" stroke-linejoin="round"/></svg><small></small>';
    arrow = el.querySelector('svg');
    label = el.querySelector('small');
    uiRoot.appendChild(el);
  }

  const goal = { x: 0, z: 0, on: false, text: '' };
  function pickGoal() {
    goal.on = false;
    const act = game.activities && game.activities.active;
    if (act && act.course && act.course.checkpoints) {
      const cp = act.course.checkpoints[act.index];
      if (cp) {
        goal.x = cp.x;
        goal.z = cp.z;
        goal.on = true;
        goal.text = act.course.name || 'Next checkpoint';
        return;
      }
    }
    const m = game.missions && game.missions.objective;
    if (m && Number.isFinite(m.x) && Number.isFinite(m.z)) {
      goal.x = m.x;
      goal.z = m.z;
      goal.on = true;
      goal.text = m.label || 'Objective';
      return;
    }
    const w = game.waypoint;
    if (w) {
      goal.x = w.x;
      goal.z = w.z;
      goal.on = true;
      goal.text = 'Waypoint';
    }
  }

  return {
    name: 'objective',
    angle: 0,
    distance: 0,
    get visible() { return goal.on; },
    render() {
      pickGoal();
      const p = game.player;
      if (goal.on && p) {
        this.angle = objectiveAngle(p.x, p.z, game.camHeading || 0, goal.x, goal.z);
        this.distance = Math.hypot(goal.x - p.x, goal.z - p.z);
      }
      if (!el) return;
      const on = goal.on && !game.paused;
      if (on !== shownOn) {
        shownOn = on;
        el.classList.toggle('rw-obj-off', !on);
      }
      if (!on) return;
      const a = Math.round(this.angle);
      if (a !== shownAngle) {
        shownAngle = a;
        arrow.style.transform = `rotate(${a}deg)`;
      }
      const d = Math.round(this.distance / 5) * 5;
      if (d !== shownDist) {
        shownDist = d;
        label.textContent = `${goal.text} ${formatDistance(d)}`;
      }
    },
  };
}
