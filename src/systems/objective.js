import { formatDistance } from '../core/units.js';
// Objective arrow: while a race or delivery is running (or a map waypoint is
// set) an arrow in the HUD status row points to where to go, with the distance.

// Degrees to turn an "up" arrow so it points at the target as seen from a
// camera facing `camHeading`. Heading 0 faces +x and increases toward +z,
// which is clockwise from above, so a positive angle is to the right.
export function objectiveAngle(px, pz, camHeading, tx, tz) {
  const bearing = Math.atan2(tz - pz, tx - px);
  let d = bearing - camHeading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return (d * 180) / Math.PI;
}

// The arrow and the distance live in the HUD's status row (hud.setObjective);
// a new or changed objective also shows once as a row 1 line (docs/REVAMP.md 6.12).
export function createObjective(game) {
  let shownAngle = 1e9, shownDist = -1, shownOn = null, shownText = '';
  let distText = '';
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
    // The tracked adventure (systems/adventures.js): the arrow points at
    // the center of its fuzzy map ring, not the true spot.
    const adv = game.adventures && game.adventures.objective;
    if (adv && Number.isFinite(adv.x) && Number.isFinite(adv.z)) {
      goal.x = adv.x;
      goal.z = adv.z;
      goal.on = true;
      goal.text = adv.label || 'Adventure';
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
      const hud = game.hud;
      if (!hud || !hud.setObjective) return;
      const on = goal.on && !game.paused;
      if (on !== shownOn) {
        shownOn = on;
        if (!on) hud.setObjective(false, 0, '');
      }
      if (!goal.on) shownText = '';
      if (!on) return;
      if (goal.text !== shownText) {
        shownText = goal.text;
        if (hud.toast) hud.toast(goal.text, 4, 'objective');
      }
      const a = Math.round(this.angle);
      const d = Math.round(this.distance / 5) * 5;
      if (a !== shownAngle || d !== shownDist) {
        if (d !== shownDist) { shownDist = d; distText = formatDistance(d); }
        shownAngle = a;
      }
      hud.setObjective(true, a, distText);
    },
  };
}
