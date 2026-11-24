import { formatDistance } from '../core/units.js';
// Score and combo. There is no money in this game: `add(points, reason,
// x, z)` is the only way to score. Rules: docs/MISSIONS.md "Score".
//
// Points earned by play (stunts, takedowns, wrecks) wait as `pending`
// and are multiplied by the combo; they bank into the saved total when
// 4 s pass quietly. A hard crash, being downed or busted loses the
// pending points. Awards (race medals, mission results, escaping the
// police) pass `bank = true`: no combo, straight into the total.
//
// Pure logic: runs in node tests. The HUD toast is optional.
import { defaultProgress } from '../core/save.js';

export const COMBO_WINDOW = 4; // seconds of quiet that bank the pending points
export const COMBO_STEP = 0.5;
export const COMBO_MAX = 5;
export const MAX_EVENT = 20000; // largest single award
export const MAX_PENDING = 1000000;
export const MAX_TOTAL = 1e9;
export const CRASH_SPEED = 8; // m/s: a harder hit loses the pending points

export const POINTS = {
  crewTakedown: 100,
  craft: 250,
  crewCraft: 400,
  chainFactor: 2, // an explosion that was set off by another one
  streak: 50, // extra for each takedown within STREAK_TIME of the last
  airtimePerSecond: 100,
  jumpPerMeter: 10,
  driftPerSecond: 50,
  nearMiss: 150,
  lowFlyPerSecond: 40,
  roofLanding: 300,
  escapePerLevel: 500,
  raceBestTime: 500,
};
export const STREAK_TIME = 3;
export const RACE_POINTS = { gold: 3000, silver: 2000, bronze: 1000, finished: 500 };

// Points for finishing a race or course: the placement plus a bonus for
// a new best time.
export function racePoints(medal, newBest) {
  return (RACE_POINTS[medal] || RACE_POINTS.finished) + (newBest ? POINTS.raceBestTime : 0);
}

const AIR_MIN = 0.5; // s of airtime before it scores
const AIR_Y = 0.3; // m above the ground that count as airborne (cars)
const AIR_Y_BOAT = 0.7;
const JUMP_MIN = 5; // m
const DRIFT_SLIP = 0.35;
const DRIFT_SPEED = 12;
const DRIFT_MIN = 0.5; // s
const DRIFT_GRACE = 0.3; // s a drift may pause before it counts as over
const NEAR_GAP = 1.2; // m between the car sides
const NEAR_SPEED = 20;
const NEAR_COOLDOWN = 3; // s per passed car
const LOW_Y = 15;
const LOW_SPEED = 40;
const ROOF_Y = 5;

const isCraft = (t) => !!t && t.spec !== undefined && t.kind !== undefined;
const isCrewCraft = (c) => c.crew === true || c.team === 'crew' || c.owner === 'crew';

export function createScore(game) {
  const events = game.events;
  let total = 0;
  let pending = 0;
  let combo = 1;
  let comboT = 0;
  let now = 0; // simulated seconds, advanced by the fixed step
  let session = 0; // points banked since the page loaded
  let nmChain = 0; // near misses inside the current combo
  let lastTake = -1e9;
  let lastEscape = -1e9;

  // Per-craft stunt trackers.
  let veh = null;
  let air = false, airT = 0, takeX = 0, takeZ = 0;
  let driftT = 0, driftAcc = 0, driftGap = 0;
  let lowT = 0;
  let wasGround = true;

  const prog = () => {
    const p = game.progress;
    if (!p) return null;
    if (!p.score) p.score = defaultProgress().score;
    return p.score;
  };

  function syncTotal() {
    const s = prog();
    if (s) s.total = total;
  }

  function toast(text) {
    if (game.hud && game.hud.toast) game.hud.toast(text, 1.6);
  }

  function bank() {
    if (pending <= 0 && comboT <= 0) return 0;
    const amount = pending;
    const s = prog();
    total = Math.min(MAX_TOTAL, total + amount);
    session += amount;
    if (s) {
      s.total = total;
      if (session > s.sessionBest) s.sessionBest = Math.min(MAX_TOTAL, session);
      if (combo > s.best.combo) s.best.combo = combo;
      if (nmChain > s.best.nearMiss) s.best.nearMiss = nmChain;
    }
    pending = 0;
    combo = 1;
    comboT = 0;
    nmChain = 0;
    if (amount > 0) {
      events.emit('scoreBanked', amount);
      events.emit('progress');
    }
    return amount;
  }

  function lose() {
    if (pending > 0) toast('Combo lost');
    pending = 0;
    combo = 1;
    comboT = 0;
    nmChain = 0;
  }

  // The only way to score. Returns the points added (after the combo).
  // `bank` true: an award, goes straight into the total without a combo.
  function add(points, reason, x, z, bankNow = false) {
    if (!(typeof points === 'number' && points > 0) || !Number.isFinite(points)) return 0;
    const base = Math.min(MAX_EVENT, Math.round(points));
    let amount;
    if (bankNow) {
      amount = base;
      total = Math.min(MAX_TOTAL, total + amount);
      session += amount;
      const s = prog();
      if (s) {
        s.total = total;
        if (session > s.sessionBest) s.sessionBest = Math.min(MAX_TOTAL, session);
      }
      events.emit('progress');
    } else {
      if (comboT > 0) combo = Math.min(COMBO_MAX, combo + COMBO_STEP);
      comboT = COMBO_WINDOW;
      amount = Math.round(base * combo);
      pending = Math.min(MAX_PENDING, pending + amount);
    }
    toast((reason || 'Points') + '  +' + amount.toLocaleString('en-US') + (combo > 1 && !bankNow ? '  x' + combo : ''));
    events.emit('scored', amount, reason, x, z);
    return amount;
  }

  function recordCourse(id, points) {
    const s = prog();
    if (!s || typeof id !== 'string' || !(points > 0)) return;
    if (!(s.courses[id] >= points)) s.courses[id] = Math.min(MAX_TOTAL, Math.floor(points));
  }

  function recordBest(key, value) {
    const s = prog();
    if (s && value > s.best[key]) s.best[key] = Math.min(MAX_TOTAL, Math.round(value * 100) / 100);
  }

  // ---- events ----
  function onTakedown(t) {
    if (!t) return;
    const target = t.target;
    let pts = 0;
    let reason = 'Takedown';
    if (isCraft(target)) {
      pts = isCrewCraft(target) ? POINTS.crewCraft : POINTS.craft;
      reason = 'Wrecked';
    } else if (target && target.team === 'crew') {
      pts = POINTS.crewTakedown;
    }
    // Civilians, officers and anything else earn nothing.
    if (pts <= 0) return;
    if (t.depth >= 1) {
      pts *= POINTS.chainFactor;
      reason = 'Chain blast';
    }
    if (now - lastTake <= STREAK_TIME) pts += POINTS.streak;
    lastTake = now;
    add(pts, reason, target ? target.x : 0, target ? target.z : 0);
  }

  function onImpact(v, impact) {
    if (v && v === game.player.vehicle && impact > CRASH_SPEED) lose();
  }
  function onCrash(a, b, impact) {
    const pv = game.player.vehicle;
    if (pv && (a === pv || b === pv) && impact > CRASH_SPEED) lose();
  }
  function onFail(id, msg) {
    if (typeof msg === 'string' && /pulled over|busted/i.test(msg)) lose();
  }
  function onEscape(level) {
    if (now - lastEscape < 1) return; // police.js may announce it twice
    lastEscape = now;
    const lv = Math.max(1, Math.min(5, Math.floor(level) || 1));
    add(POINTS.escapePerLevel * lv, 'Lost the police', game.player.x, game.player.z, true);
  }
  function onReward(amount, reason) {
    if (reason === 'Lost the police') {
      const h = game.police && game.police.heat;
      onEscape(h ? h.escapedLevel : 1);
    }
  }
  function onMissionDone(d) {
    const s = prog();
    if (!s || !d || typeof d.id !== 'string') return;
    const old = s.missions[d.id];
    const best = Math.floor(Math.max(0, Math.min(MAX_TOTAL, Number(d.score) || 0)));
    const time = Math.max(0, Math.min(86400, Number(d.time) || 0));
    if (!old) {
      s.missions[d.id] = { best, time, done: true };
    } else {
      old.done = true;
      if (best > old.best) old.best = best;
      if (time > 0 && (!(old.time > 0) || time < old.time)) old.time = time;
    }
    events.emit('progress');
  }
  function onReset() {
    total = 0;
    pending = 0;
    combo = 1;
    comboT = 0;
    session = 0;
    nmChain = 0;
    resetCraft(null);
  }

  const offs = [
    events.on('takedown', onTakedown),
    events.on('playerDown', lose),
    events.on('vehicleImpact', onImpact),
    events.on('vehicleCrash', onCrash),
    events.on('fail', onFail),
    events.on('busted', lose),
    events.on('escaped', onEscape),
    events.on('reward', onReward),
    events.on('missionDone', onMissionDone),
    events.on('progressReset', onReset),
  ];

  // ---- stunts ----
  function resetCraft(v) {
    veh = v;
    air = false;
    airT = 0;
    driftT = driftAcc = driftGap = 0;
    lowT = 0;
    wasGround = true;
  }

  function endDrift() {
    if (driftT >= DRIFT_MIN) {
      const pts = Math.round(driftAcc);
      recordBest('drift', pts);
      add(pts, 'Drift', veh.x, veh.z);
    }
    driftT = driftAcc = driftGap = 0;
  }

  function stunts(v, dt) {
    if (v !== veh) resetCraft(v);
    const kind = v.kind;
    const speed = Math.abs(v.speed || 0);

    if (kind === 'car' || kind === 'boat') {
      // Ramp jumps (systems/stunts.js, v.stuntRamp) score there instead.
      const up = (v.y || 0) > (kind === 'boat' ? AIR_Y_BOAT : AIR_Y) && !v.wrecked && !v.stuntRamp;
      if (up && !air) {
        air = true;
        airT = 0;
        takeX = v.x;
        takeZ = v.z;
      } else if (up) {
        airT += dt;
      } else if (air) {
        air = false;
        if (airT >= AIR_MIN) {
          recordBest('airtime', airT);
          add(airT * POINTS.airtimePerSecond, 'Airtime', v.x, v.z);
          const dist = Math.hypot(v.x - takeX, v.z - takeZ);
          if (dist >= JUMP_MIN) {
            recordBest('jump', dist);
            add(dist * POINTS.jumpPerMeter, 'Jump ' + formatDistance(dist), v.x, v.z);
          }
        }
      }
    }

    if (kind === 'car') {
      if (!air && (v.slip || 0) > DRIFT_SLIP && speed > DRIFT_SPEED) {
        driftT += dt;
        driftAcc += POINTS.driftPerSecond * dt;
        driftGap = 0;
      } else if (driftT > 0 && (driftGap += dt) > DRIFT_GRACE) {
        endDrift();
      }
      if (speed > NEAR_SPEED) nearMisses(v);
    }

    if (kind === 'plane') {
      if (!v.onGround && (v.y || 0) < LOW_Y && speed > LOW_SPEED) {
        lowT += dt;
        if (lowT >= 1) {
          lowT -= 1;
          add(POINTS.lowFlyPerSecond, 'Low flying', v.x, v.z);
        }
      } else {
        lowT = 0;
      }
    }

    if (kind === 'heli') {
      const ground = !!v.onGround;
      if (ground && !wasGround && (v.y || 0) >= ROOF_Y) add(POINTS.roofLanding, 'Roof landing', v.x, v.z);
      wasGround = ground;
    }
  }

  function nearMisses(v) {
    const vs = game.vehicles;
    if (!vs) return;
    const wv = (v.spec && v.spec.width ? v.spec.width : 1.8) / 2;
    for (let i = 0; i < vs.length; i++) {
      const o = vs[i];
      if (o === v || o.kind !== 'car' || !o.driver || o.wrecked || o.removed) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (dx > 6 || dx < -6 || dz > 6 || dz < -6) continue;
      if (o.nearMissT > now) continue;
      const wo = (o.spec && o.spec.width ? o.spec.width : 1.8) / 2;
      const gap = Math.hypot(dx, dz) - wv - wo;
      if (gap > 0 && gap < NEAR_GAP && !(v.impact > 0)) {
        o.nearMissT = now + NEAR_COOLDOWN;
        nmChain++;
        add(POINTS.nearMiss, 'Near miss', v.x, v.z);
      }
    }
  }

  const sys = {
    name: 'score',
    game,
    get total() { return total; },
    get pending() { return pending; },
    get combo() { return combo; },
    get session() { return session; },
    add,
    bank,
    lose,
    recordCourse,
    dispose() { for (const off of offs) off(); },
    fixedUpdate(dt) {
      now += dt;
      const s = prog();
      if (s && s.total !== total) {
        // Something outside (a loaded save) changed the saved total.
        if (s.total > total) total = s.total;
        else s.total = total;
      }
      const p = game.player;
      const v = p && p.vehicle;
      if (v) stunts(v, dt);
      else if (veh) {
        if (driftT > 0) endDrift();
        resetCraft(null);
      }
      if (comboT > 0 && (comboT -= dt) <= 0) bank();
      const hs = game.hudState;
      if (hs) {
        hs.score = total;
        hs.pending = pending;
        hs.combo = combo;
      }
    },
  };
  total = (prog() && prog().total) || 0;
  syncTotal();
  return sys;
}
