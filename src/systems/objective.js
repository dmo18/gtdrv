import { formatDistance } from '../core/units.js';
import { createRouter, createRoute, createTracker, turnPhrase, formatTurnDistance, shortStreet as shortName } from '../core/route.js';
// Objective arrow and GPS: while a race or delivery is running, a mission
// or an adventure is tracked, or a map waypoint is set, an arrow in the HUD
// status row points to where to go, with the distance; on the road network
// (car, tank, on foot) the same goal gets a route (src/core/route.js): the
// line on both maps and the distance along the road. Turn by turn (the one
// line turn pill "200 ft · SW 1st Ave" in the stack's second row, and its
// chimes) shows only for a goal the player chose or accepted: a map
// destination, a running activity or mission. A merely tracked adventure
// keeps the small distance pill only, and the Phone check never shows it.
// A U-turn is only asked for after UTURN_WAIT_S of the route still wanting
// one; until then the route is searched again every REPLAN_S as the car
// drives on, so a way ahead replaces it. The street label under the minimap
// names the street the player is on (city.streetAt). A burning player's car
// shows a red "Get out!" prompt.

// Degrees to turn an "up" arrow so it points at the target as seen from a
// camera facing `camHeading`. Heading 0 faces +x and increases toward +z,
// which is clockwise from above, so a positive angle is to the right.
export function objectiveAngle(px, pz, camHeading, tx, tz) {
  const bearing = Math.atan2(tz - pz, tx - px);
  let d = bearing - camHeading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return (d * 180) / Math.PI;
}

const ROAD_MODES = { car: true, tank: true, foot: true };
const GOAL_MOVE_M = 25; // a goal that moves farther than this gets a new route
const PREP_M = 152; // 500 ft: the first chime before a turn
const NOW_M = 18; // the chime at the turn
const AIM_AHEAD_M = 45; // the arrow aims this far ahead on the route
const STREET_EVERY = 0.25; // seconds between street lookups
export const UTURN_WAIT_S = 3; // the route has wanted a U-turn this long before the pill asks for one
export const REPLAN_S = 1; // while it wants one, search again this often (a way ahead wins)
// After "You have arrived" the same goal gets no new route until the player is this far from
// where they arrived (a goal off the road, like a garage door 25 m up a drive, would else be
// searched again and "arrived" every step: the line repeated and no route to follow).
export const REARM_M = 60;
// Road graph nodes a route search may close in one step (about 1.5 ms on a
// slow phone; most searches fit in one, a search across Downtown takes about 10).
export const ROUTE_BUDGET = 150;
// Goals that get turn by turn: chosen (waypoint) or accepted (activity, mission).
export const NAV_SOURCES = { waypoint: true, activity: true, mission: true };
export function wantsTurnByTurn(src, checking) {
  return !checking && NAV_SOURCES[src] === true;
}

// The distance as the strip shows it changes in steps: a number that only
// changes with the text (no strings made per frame).
export function navBucket(d) {
  if (!(d > 15)) return -1;
  const ft = d * 3.28084;
  if (ft < 975) return Math.round(ft / (ft < 100 ? 10 : 50));
  return 10000 + Math.round(d / 160.9344);
}

// Pure parts (node tests): the strip lines for a tracker state.
// Returns { kind, l1, l2, soon } into `out`.
export function navLines(tr, out) {
  const t = tr.next();
  if (!t) { out.kind = ''; out.l1 = ''; out.l2 = ''; out.soon = false; return out; }
  const d = tr.toTurn;
  out.kind = t.kind;
  out.soon = d < PREP_M;
  const phrase = turnPhrase(t);
  const at = phrase.indexOf(' onto ');
  const verb = at >= 0 ? phrase.slice(0, at) : phrase;
  const rest = at >= 0 ? phrase.slice(at + 1) : '';
  if (t.kind === 'arrive') {
    out.l1 = d > 15 ? 'In ' + formatTurnDistance(d) + ', arrive' : 'Arriving';
    out.l2 = t.name ? 'at ' + t.name : '';
  } else {
    out.l1 = d > 15 ? 'In ' + formatTurnDistance(d) + ', ' + verb : verb.charAt(0).toUpperCase() + verb.slice(1);
    out.l2 = rest;
  }
  return out;
}

// The one line of the turn pill for a tracker state: { kind, text, soon }
// into `out`. "200 ft · SW 1st Ave"; at the turn the verb ("Turn right ·
// SW 1st Ave"); "U-turn · S Miami Ave"; "0.4 mi · Lincoln Rd" before the end.
// On foot (walk) a U-turn reads "Turn around".
const CAP_VERB = { uturn: 'U-turn' };
export function navPill(tr, out, walk = false) {
  const t = tr.next();
  if (!t) { out.kind = ''; out.text = ''; out.soon = false; return out; }
  const d = tr.toTurn;
  out.kind = t.kind;
  out.soon = d < PREP_M;
  const name = t.name || '';
  let head;
  if (t.kind === 'arrive') head = d > 15 ? formatTurnDistance(d) : 'Arriving';
  else if (CAP_VERB[t.kind]) head = walk && t.kind === 'uturn' ? 'Turn around' : CAP_VERB[t.kind];
  else if (d > 15) head = formatTurnDistance(d);
  else {
    const phrase = turnPhrase({ kind: t.kind, name: '' });
    head = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  }
  if (name) out.text = head + ' \u00b7 ' + name;
  else if (t.kind !== 'arrive' && d > 15 && !CAP_VERB[t.kind]) out.text = head + ' \u00b7 ' + turnPhrase(t);
  else out.text = head;
  return out;
}

export function createObjective(game) {
  let shownAngle = 1e9, shownDist = -1, shownOn = null, shownText = '';
  let distText = '';
  const goal = { x: 0, z: 0, on: false, text: '', src: '', h: NaN }; // h: the heading to arrive in (a street event gate), NaN any
  const city = game.city;
  const canRoute = !!(city && Array.isArray(city.nodes) && city.nodes.length > 1 && Array.isArray(city.edges) && city.edges.length);
  const router = canRoute ? createRouter(city) : null;
  // A long search runs over several steps (ROUTE_BUDGET nodes a step):
  // the guidance before it stays until it is done (0.13.8 remaining hitches).
  const tracker = router ? createTracker(router, { budget: ROUTE_BUDGET }) : null;
  // One throwaway search at load (into a small route of its own): the
  // search code's first run is several times slower than the next, and it
  // landed on the first step of a check or event (0.13.8: 10 to 20 ms at
  // a 4x throttle). No state is kept between searches, so no route changes.
  if (router && city.spawn) {
    const sp = city.spawn, h = sp.heading || 0;
    router.search(sp.x, sp.z, h, sp.x + Math.cos(h) * 600, sp.z + Math.sin(h) * 600, createRoute(64, 8), true, NaN);
  }
  const routed = { x: 0, z: 0, src: '', on: false, legal: true, h: NaN };
  let avoidSet = false;
  const aim = { x: 0, z: 0 };
  const lines = { kind: '', text: '', soon: false };
  let uturnT = 0, replanT = 0; // seconds the route has wanted a U-turn; time to the next search
  const street = { edge: -1, name: '', cross: '', d: 0, side: 1 };
  let streetT = 0, streetShown = '', crossShown = '';
  let chimeTurn = -1, chimeStage = 0, chimeRev = -1;
  let alertCraft = null;
  let navB = -2, navTurn = -1, navRev = -1, navWalk = false;
  const arrivedAt = { x: NaN, z: NaN, gx: NaN, gz: NaN }; // where the player was told "arrived", and the goal then

  function pickGoal() {
    goal.on = false;
    goal.h = NaN;
    const act = game.activities && game.activities.active;
    if (act && act.course && act.course.checkpoints) {
      const cp = act.course.checkpoints[act.index];
      if (cp) {
        goal.x = cp.x;
        goal.z = cp.z;
        goal.on = true;
        goal.text = act.course.name || 'Next checkpoint';
        goal.src = 'activity';
        return;
      }
    }
    const m = game.missions && game.missions.objective;
    if (m && Number.isFinite(m.x) && Number.isFinite(m.z)) {
      goal.x = m.x;
      goal.z = m.z;
      goal.on = true;
      goal.text = m.label || 'Objective';
      goal.src = 'mission';
      if (Number.isFinite(m.heading)) goal.h = m.heading;
      return;
    }
    // A destination the player set on the map comes before a merely tracked
    // adventure (it is what they chose; it gets turn by turn).
    const w = game.waypoint;
    if (w) {
      goal.x = w.x;
      goal.z = w.z;
      goal.on = true;
      goal.text = 'Waypoint';
      goal.src = 'waypoint';
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
      goal.src = 'adventure';
      return;
    }
  }

  // Keep the tracker's goal in step with the objective (a new search only
  // when the goal, its source or the legal rule changed).
  function syncRoute(force) {
    if (!tracker) return;
    const p = game.player;
    const want = goal.on && !!p && ROAD_MODES[p.mode] === true;
    const legal = !p || p.mode !== 'foot';
    if (!want) {
      if (routed.on) { tracker.clear(); routed.on = false; }
      return;
    }
    const moved = Math.hypot(goal.x - routed.x, goal.z - routed.z) > GOAL_MOVE_M;
    const turned = Number.isFinite(goal.h) !== Number.isFinite(routed.h) || (Number.isFinite(goal.h) && Math.cos(goal.h - routed.h) < 0.9);
    const goalChanged = moved || turned || routed.src !== goal.src;
    // Arrived at this goal already: no new search until the player drives away from it.
    if (!force && routed.src === 'arrived' && Math.hypot(goal.x - arrivedAt.gx, goal.z - arrivedAt.gz) <= GOAL_MOVE_M &&
      Math.hypot(p.x - arrivedAt.x, p.z - arrivedAt.z) < REARM_M) return;
    if (force || !routed.on || goalChanged || routed.legal !== legal) {
      routed.on = true; routed.x = goal.x; routed.z = goal.z; routed.src = goal.src; routed.legal = legal; routed.h = goal.h;
      // The GPS keeps out of the other street event gates (a penalty).
      if (router.setAvoid && (goalChanged || !avoidSet)) {
        const se = game.streetEvents;
        router.setAvoid(se && se.list ? se.list : null, goal.x, goal.z);
        avoidSet = true;
      }
      tracker.setGoal(goal.x, goal.z, legal, goal.h);
    }
  }
  function headingOf(p) {
    return p.vehicle ? p.vehicle.heading : (p.walker ? p.walker.heading : (p.heading || 0));
  }
  function speedOf(p) {
    const v = p.vehicle;
    if (v) return Math.abs(v.speed || 0);
    return p.walker ? Math.abs(p.walker.speed || 0) : 0;
  }

  function onArrive() {
    const p = game.player;
    arrivedAt.x = p.x; arrivedAt.z = p.z; arrivedAt.gx = goal.x; arrivedAt.gz = goal.z;
    if (game.hud && game.hud.toast) game.hud.toast('You have arrived', 3, 'objective');
    // The intro's garage beat ends here (its door may stand back from the road).
    if (game.events && game.events.emit) game.events.emit('gpsArrived', goal.src, goal.x, goal.z);
    if (goal.src === 'waypoint' && game.waypoint) {
      game.waypoint = null;
      if (game.map && game.map.clearWaypoint) game.map.clearWaypoint();
    }
    tracker.clear();
    routed.on = false;
    routed.src = 'arrived';
  }

  // The burning event (systems/combat.js): the player's own car on fire.
  if (game.events && game.events.on) {
    game.events.on('burning', (e) => {
      if (!e || !e.craft) return;
      const p = game.player;
      if (e.on && p && e.craft === p.vehicle) {
        alertCraft = e.craft;
        if (game.hud && game.hud.setAlert) game.hud.setAlert('Get out!');
      } else if (!e.on && e.craft === alertCraft) {
        alertCraft = null;
        if (game.hud && game.hud.setAlert) game.hud.setAlert(null);
      }
    });
  }

  const sys = {
    name: 'objective',
    angle: 0,
    distance: 0,
    tracker,
    get route() { return tracker ? tracker.route : null; },
    get visible() { return goal.on; },
    goalLabel: () => (goal.on ? goal.text : ''),
    // True while a route is drawn and followed.
    get routing() { return !!(tracker && tracker.active && tracker.route.ok && !tracker.arrived); },
    // Pick the goal and search right away (the full map calls this after a tap, while paused).
    refresh() {
      pickGoal();
      syncRoute(true);
      const p = game.player;
      if (tracker && tracker.active && p) tracker.settle(p.x, p.z, headingOf(p));
    },
    fixedUpdate(dt) {
      pickGoal();
      syncRoute(false);
      const p = game.player;
      if (!tracker || !p || !routed.on) return;
      tracker.update(p.x, p.z, headingOf(p), speedOf(p), dt);
      if (tracker.arrived) { onArrive(); uturnT = 0; return; }
      // A route that starts with (or next asks for) a U-turn: search again as
      // the car drives on; only after UTURN_WAIT_S does the pill ask for it.
      const t = tracker.active && tracker.route.ok ? tracker.next() : null;
      if (t && t.kind === 'uturn') {
        uturnT += dt;
        replanT -= dt;
        if (replanT <= 0 && uturnT < UTURN_WAIT_S && speedOf(p) > 2) {
          replanT = REPLAN_S;
          // (Within the search budget: a long search ends in a later step,
          // whose route is then read here as it is now.)
          if (tracker.searchSoon(p.x, p.z, headingOf(p))) {
            const n = tracker.route.ok ? tracker.next() : null;
            if (!n || n.kind !== 'uturn') uturnT = 0;
          }
        }
      } else { uturnT = 0; replanT = REPLAN_S; }
    },
    // Seconds the route has wanted a U-turn (tests).
    get uturnWait() { return uturnT; },
    render(_alpha, dt) {
      pickGoal();
      const p = game.player;
      const hud = game.hud;
      const routing = sys.routing && goal.on;
      if (goal.on && p) {
        // On a route the arrow points along it (a point ahead on the line, so
        // it agrees with the turn pill); with no route, at the goal itself.
        if (routing && tracker.lookAhead(AIM_AHEAD_M, aim)) this.angle = objectiveAngle(p.x, p.z, game.camHeading || 0, aim.x, aim.z);
        else this.angle = objectiveAngle(p.x, p.z, game.camHeading || 0, goal.x, goal.z);
        this.distance = routing ? tracker.remaining : Math.hypot(goal.x - p.x, goal.z - p.z);
      }
      // The street line and the burning alert first (no goal needed).
      if (hud && hud.setStreet && p) {
        streetT -= dt > 0 ? dt : 0;
        if (streetT <= 0) {
          streetT = STREET_EVERY;
          let name = '', cross = '';
          if (p.mode !== 'plane' && p.mode !== 'heli' && p.mode !== 'boat' && city && city.streetAt) {
            const r = city.streetAt(p.x, p.z, street, headingOf(p));
            if (r) { name = r.name; cross = r.cross; }
          }
          if (name !== streetShown || cross !== crossShown) {
            streetShown = name; crossShown = cross;
            hud.setStreet(shortName(name), shortName(cross));
          }
        }
      }
      if (alertCraft && hud && hud.setAlert && (!p || p.vehicle !== alertCraft || !alertCraft.burning)) {
        alertCraft = null;
        hud.setAlert(null);
      }
      if (!hud || !hud.setObjective) return;
      const on = goal.on && !game.paused;
      if (on !== shownOn) {
        shownOn = on;
        if (!on) hud.setObjective(false, 0, '');
      }
      if (!goal.on) shownText = '';
      // The turn strip and the chimes.
      if (hud.setNav) {
        const checking = !!game.phoneCheckRunning;
        const nt = on && routing && wantsTurnByTurn(goal.src, checking) ? tracker.next() : null;
        const holdU = !!nt && nt.kind === 'uturn' && uturnT < UTURN_WAIT_S && !!p && p.mode !== 'foot'; // a walker just turns round
        if (nt && !holdU) {
          const b = navBucket(tracker.toTurn);
          const walk = p.mode === 'foot';
          if (b !== navB || tracker.turn !== navTurn || tracker.rev !== navRev || walk !== navWalk) {
            navB = b; navTurn = tracker.turn; navRev = tracker.rev; navWalk = walk;
            navPill(tracker, lines, walk);
          }
          hud.setNav(true, lines.kind, lines.text, '', tracker.toTurn < PREP_M);
          if (tracker.rev !== chimeRev || tracker.turn !== chimeTurn) {
            chimeRev = tracker.rev; chimeTurn = tracker.turn;
            chimeStage = tracker.toTurn < PREP_M ? 1 : 0; // no chime for a turn already close
            if (tracker.toTurn < NOW_M) chimeStage = 2;
          }
          const t = tracker.next();
          if (t && t.kind !== 'arrive' && game.events) {
            if (chimeStage === 0 && tracker.toTurn < PREP_M) { chimeStage = 1; game.events.emit('ui'); }
            else if (chimeStage === 1 && tracker.toTurn < NOW_M) { chimeStage = 2; game.events.emit('checkpoint', 'nav'); }
          }
        } else hud.setNav(false);
      }
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
  return sys;
}
